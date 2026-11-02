"""Cause separation, HTTP provenance, paired sampling and encrypted-history tests."""
import datetime as dt
import json
import unittest
from unittest import mock
from scripts import gsc_monitor as g, gsc_private as p, gsc_diagnostics as d

URL = g.SITE + "2026/09/test.html"
DATE = "2026-11-02T10:00:00+00:00"


def saved(fetch="SUCCESSFUL", verdict="NEUTRAL", crawl="2026-09-14T00:00:00Z"):
    return {"verdict": verdict, "pageFetchState": fetch, "lastCrawlTime": crawl,
            "coverageState": "Crawled - currently not indexed", "userCanonical": URL,
            "googleCanonical": URL}


def entry(**kw):
    return {"url": URL, "original": saved(), "mobile": saved(), **kw}


class Response:
    def __init__(self, code, location=None, body=None):
        self.status = code
        self.headers = {"Location": location} if location is not None else {}
        self.body = body or ('<link rel="canonical" href="'+URL+'">' +
                           '<script type="application/ld+json">{"dateModified":"2026-10-22T00:00:00Z"}</script>').encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, _): return self.body


class DiagnosticsTests(unittest.TestCase):
    def probe(self, responses, max_hops=4):
        opener = mock.Mock()
        opener.open.side_effect = responses
        with mock.patch.object(g.urllib.request, "build_opener", return_value=opener):
            return g.http_chain(URL, max_hops=max_hops)

    def test_mobile_success_records_location_and_provenance(self):
        x = self.probe([Response(302, URL+'?m=1'), Response(200)])
        self.assertEqual(x['reason'], 'normal_blogger_mobile_redirect')
        self.assertEqual(x['source'], 'ordinary_http_android')
        self.assertEqual(x['chain'][0]['location'], URL+'?m=1')
        self.assertEqual(x['final_status'], 200)
        self.assertEqual(x['redirects'], 1)
        self.assertEqual(x['modified_at'], '2026-10-22T00:00:00Z')
        self.assertTrue(x['canonical_ok'])

    def test_failure_reasons_are_separate(self):
        self.assertEqual(self.probe([Response(302)])['reason'], 'missing_location')
        self.assertEqual(self.probe([Response(302, URL)])['reason'], 'redirect_loop')
        outside = self.probe([Response(302, 'https://elsewhere.example/')])
        self.assertEqual(outside['reason'], 'out_of_scope_target_not_followed')
        self.assertEqual(outside['result'], 'inconclusive')
        self.assertEqual(outside['final_url'], URL)
        self.assertEqual(outside['unfetched_target'], 'https://elsewhere.example/')
        self.assertEqual(self.probe([Response(302, URL+'?m=1')], 0)['reason'], 'redirect_limit_reached')
        self.assertEqual(self.probe([Response(404)])['result'], 'http_404')
        self.assertEqual(self.probe([TimeoutError()])['reason'], 'network_error')
        self.assertEqual(self.probe([Response(302, 'https://[broken')])['reason'], 'invalid_location')

    def test_http_error_response_still_preserves_headers(self):
        error = g.urllib.error.HTTPError(URL, 302, 'redirect', {'Location':URL+'?m=1'}, None)
        self.assertEqual(self.probe([error, Response(200)])['final_status'], 200)

    def test_same_host_http_transition_is_followed_without_relaxing_gsc_scope(self):
        middle=URL.replace('https:', 'http:')+'?m=1'
        x=self.probe([Response(302,middle),Response(301,URL+'?m=1'),Response(200)])
        self.assertEqual(x['result'],'ok')
        self.assertEqual(x['redirects'],2)
        self.assertEqual(x['chain'][1]['status'],301)
        self.assertFalse(g.is_blog_url(middle,allow_query=True))

    def test_mobile_fetch_failure_and_http_policy_stop_remain_separate(self):
        x=p.classify(saved(),saved('REDIRECT_ERROR'),{'result':'inconclusive'})
        self.assertEqual(x['reason'],'SAVED_GSC_FETCH_PROBLEM')
        x=p.classify(saved(),saved(),{'result':'inconclusive'})
        self.assertEqual(x['reason'],'HTTP_PROBE_INCONCLUSIVE')

    def test_http_recovery_is_recorded_as_change_not_indexing(self):
        changes=d.differences(entry(http={'result':'bad_redirect'}),entry(http={'result':'ok'}))
        self.assertIn({'variant':'ordinary_http','field':'result','before':'bad_redirect','after':'ok'},changes)

    def test_groups_only_exact_mobile_variant(self):
        self.assertEqual(d.group_url(URL+'?m=1'), URL)
        for url in (URL+'?m=0', URL+'?x=1', URL+'#hash', 'https://evil.example/test'):
            with self.assertRaises(ValueError): d.group_url(url)

    def test_fetch_success_is_not_index_transition(self):
        before = p.merge(None, [entry(original=saved('REDIRECT_ERROR'))], DATE)
        after = p.merge(before, [entry()], '2026-11-03T10:00:00Z')
        o = after['records'][0]['observations'][-1]
        self.assertEqual(o['transitions']['original'], 'fetch_recovered_only')
        self.assertNotEqual(o['transitions']['original'], 'became_indexed')
        indexed = p.merge(after, [entry(original=saved(verdict='PASS'))], '2026-11-04T10:00:00Z')
        self.assertEqual(indexed['records'][0]['observations'][-1]['transitions']['original'], 'became_indexed')

    def test_after_modification_requires_success_not_just_new_timestamp(self):
        snap = entry(original=saved('REDIRECT_ERROR', crawl='2026-11-01T00:00:00Z'))
        r = d.recrawl_state(snap, '2026-10-22T00:00:00Z')['variants']
        self.assertEqual(r['original'], 'attempted_after_modification_fetch_failed')
        self.assertEqual(r['mobile'], 'crawl_predates_modification')
        self.assertEqual(d.recrawl_state(snap, None)['variants']['mobile'], 'unknown')

    def test_sitemap_modified_date_survives_inconclusive_http(self):
        xml=('<?xml version="1.0"?><urlset><url><loc>'+URL+'</loc><lastmod>2026-10-22T00:00:00Z</lastmod></url></urlset>').encode()
        modified={}
        with mock.patch.object(g,'get_bytes',return_value=xml):
            self.assertIn(URL,g.read_sitemap(modified))
        r=p.merge(None,[entry(modified_at=modified[URL],modified_source='sitemap_lastmod',http={'result':'inconclusive'})],DATE)
        o=r['records'][0]['observations'][0]
        self.assertEqual(o['recrawl']['modified_source'],'sitemap_lastmod')
        self.assertEqual(o['recrawl']['variants']['original'],'crawl_predates_modification')

    def test_crawl_evidence_not_inferred_from_http(self):
        evidence = [{'url':URL+'?m=1', 'crawled_at':'2026-10-17T00:00:00Z',
                     'status':200, 'source':'gsc_crawl_stats_export'}]
        r = p.merge(None, [entry(http={'result':'ok'})], DATE, evidence)
        self.assertEqual(len(r['records'][0]['observations'][-1]['crawl_stats_mismatches']), 1)
        self.assertFalse(d.evidence_mismatches(URL, entry(http={'result':'ok'}), []))

    def test_malformed_private_export_fails_without_logging_values(self):
        with mock.patch.dict(g.os.environ, {'GSC_CRAWL_EVIDENCE_JSON':json.dumps([{'url':'secret'}])}):
            with self.assertRaisesRegex(RuntimeError, 'GSC_CRAWL_EVIDENCE_INVALID'):
                d.crawl_evidence_from_secret()

    def test_same_day_events_survive_rerun_and_32_day_history(self):
        old = p.merge(None, [entry(original=saved('REDIRECT_ERROR'))], DATE)
        new = p.merge(old, [entry()], '2026-11-02T12:00:00Z')
        new = p.merge(new, [entry()], '2026-11-02T13:00:00Z')
        self.assertEqual(len(new['records'][0]['observations']), 1)
        self.assertEqual(len(new['records'][0]['events']), 1)
        for n in range(40):
            stamp = (dt.datetime(2026,11,3,tzinfo=dt.timezone.utc)+dt.timedelta(days=n)).isoformat()
            new = p.merge(new,[entry()],stamp)
        self.assertEqual(len(new['records'][0]['observations']),32)

    def test_mobile_failure_does_not_drop_original_and_focus_all_paired(self):
        urls = list(d.FOCUS_URLS)
        def fake_inspect(url, token):
            if url.endswith('?m=1'): raise RuntimeError('network failure')
            return saved()
        details=[]
        with (mock.patch.object(g,'credentials_from_secret',return_value='fake'),
              mock.patch.object(g,'read_sitemap',return_value=urls),
              mock.patch.object(g,'inspect',side_effect=fake_inspect),
              mock.patch.object(g,'http_chain',return_value={'result':'ok','canonical_ok':True})):
            public=g.collect(dt.date(2026,11,2), detail_sink=details, focus_urls=urls)
        self.assertEqual(public['sample']['inspected_original'],15)
        self.assertEqual(public['sample']['inspection_errors'],15)
        self.assertTrue(all(x['original'] and 'mobile' in x['errors'] for x in details))
        self.assertNotIn(urls[0],json.dumps(public))
        self.assertEqual(public['status'],'partial')

    def test_snapshot_is_not_confirmed_index_transition_without_baseline(self):
        r=p.merge(None,[entry(original=saved(verdict='PASS'))],DATE)
        self.assertEqual(r['records'][0]['observations'][0]['transitions']['original'],'indexed_snapshot')


if __name__ == '__main__': unittest.main()
