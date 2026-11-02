"""Exercise actual inline dashboard rendering with a minimal offline DOM."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest


class DashboardTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node checked by GSC workflow")
    def test_private_render_and_local_evidence_no_network_or_html_injection(self):
        page=(Path(__file__).parents[1]/'gsc.html').read_text()
        script=re.findall(r'<script(?:\s+[^>]*)?>([\s\S]*?)</script>',page)[0]
        harness=r'''
const vm=require('node:vm'), assert=require('node:assert/strict');
class Element {
 constructor(){this.children=[];this.style={};this.value='all';this.events={};this.textContent=''}
 append(e){this.children.push(e)}
 replaceChildren(){this.children=[]}
 setAttribute(k,v){this[k]=v}
 addEventListener(k,f){this.events[k]=f}
}
const elements={},document={getElementById:id=>elements[id]??(elements[id]=new Element()),createElement:()=>new Element()};
const sandbox={document,URL,console,TextEncoder,TextDecoder,Uint8Array,atob,Date,
 crypto:require('node:crypto').webcrypto,fetch:()=>new Promise(()=>{})};
vm.createContext(sandbox);
vm.runInContext(SOURCE,sandbox);
vm.runInContext(`
privateReport={records:[{url:'https://wic12.blogspot.com/2026/09/test.html',priority:1,reason:'SAVED_GSC_FETCH_PROBLEM',tracked_focus:true,observations:[{observed_at:'2026-11-02T10:00:00Z',original:{verdict:'NEUTRAL',coverageState:'<img onerror=evil()>',pageFetchState:'REDIRECT_ERROR'},mobile:{verdict:'PASS'},http:{result:'ok',reason:'normal_blogger_mobile_redirect',final_status:200,redirects:1,chain:[{url:'test',status:302,location:'test?m=1'}]},changes:[]}]}]};renderPrivate();`,sandbox);
const text=e=>e.textContent+' '+e.children.map(text).join(' ');
assert.match(text(elements['private-list']),/원인 미확정/);
assert.match(text(elements['private-list']),/Location: test\?m=1/);
assert.match(text(elements['private-list']),/<img onerror=evil\(\)>/); // remains text
elements['private-filter'].value='tracking';vm.runInContext('renderPrivate()',sandbox);
assert.equal(elements['private-list'].children.length,1);
elements['private-filter'].value='changed';vm.runInContext('renderPrivate()',sandbox);
assert.equal(elements['private-list'].children.length,0);
elements['private-lock'].events.click();
assert.equal(elements['private-list'].children.length,0);
assert.equal(vm.runInContext('privateReport',sandbox),null);
'''.replace('SOURCE',json.dumps(script))
        subprocess.run(['node','-e',harness],check=True,capture_output=True,text=True)


if __name__=='__main__': unittest.main()
