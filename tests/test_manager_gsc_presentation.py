"""Exercise actual inline dashboard rendering with a minimal offline DOM."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest


class GscHttpPresentationTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node checked by GSC workflow")
    def test_http_status_does_not_treat_missing_evidence_as_zero(self):
        page=(Path(__file__).parents[1]/'gsc.html').read_text()
        script=re.findall(r'<script(?:\s+[^>]*)?>([\s\S]*?)</script>',page)[0]
        harness=r'''
const vm=require('node:vm'), assert=require('node:assert/strict');
class Element {
 constructor(){this.children=[];this.style={};this.textContent=''}
 append(e){this.children.push(e)}
 replaceChildren(){this.children=[]}
 addEventListener(){}
}
const elements={},document={getElementById:id=>elements[id]??(elements[id]=new Element()),createElement:()=>new Element()};
const sandbox={document,TextEncoder,fetch:()=>new Promise(()=>{})};
vm.createContext(sandbox);
vm.runInContext(SOURCE,sandbox);
const run=(http)=>{
 sandbox.report={schema:1,site:'https://wic12.blogspot.com/',sample_only:true,status:'ok',
  updated_at:'2026-11-14T06:50:13Z',http,sample:{counts:{not_indexed:26}},history:[
   {date:'2026-11-12',http_redirect_problem:0},
   {date:'2026-11-13',http_redirect_problem:0,http_checked:20,http_probe_quality:'complete'},
   {date:'2026-11-14',http_redirect_problem:0}]};
 vm.runInContext('render(report)',sandbox);
};
run({checked:20,probe_quality:'unverifiable',inconclusive:20,ok:0,redirect_problem:0,canonical_mismatch:0});
assert.match(elements.httpquality.textContent,/판정 불가 20\/20건/);
assert.equal(elements.redirect.textContent,'확인 못 함');
assert.match(elements.httpdetails.textContent,/canonical 차이 확인 못 함/);
assert.equal(elements.notindexed.textContent,'26');
assert.deepEqual(elements.history.children.map(row=>row.children[5].textContent),['확인 못 함','0','판정 범위 미기록']);
run({checked:20,probe_quality:'partial',inconclusive:11,reason_counts:{network_error:2},ok:7,redirect_problem:0,canonical_mismatch:0});
assert.match(elements.httpquality.textContent,/일부 판정 불가 13\/20건/);
assert.equal(elements.redirect.textContent,'0');
assert.match(elements.httpdetails.textContent,/canonical 차이 0건/);
run({checked:0,probe_quality:'complete',ok:0,redirect_problem:0});
assert.match(elements.httpquality.textContent,/검사 기록 없음/);
assert.equal(elements.redirect.textContent,'확인 못 함');
'''.replace('SOURCE',json.dumps(script))
        completed=subprocess.run(['node','-e',harness],capture_output=True,text=True)
        self.assertEqual(completed.returncode,0,completed.stderr)


if __name__=='__main__': unittest.main()
