"""Exercise the actual post list renderer and combined search/filter behavior."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import unittest


class PostSearchTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node checked by code-integrity workflow")
    def test_search_filters_pages_and_keeps_report_intact(self):
        page=(Path(__file__).parents[1]/'index.html').read_text()
        script=next(s for s in re.findall(r'<script(?:\s+[^>]*)?>([\s\S]*?)</script>',page) if 'function renderPosts()' in s)
        harness=r'''
const assert=require('node:assert/strict'), vm=require('node:vm');
const el={}, get=id=>el[id]??(el[id]={innerHTML:'',textContent:'',value:'',focus(){this.focused=true}});
const document={getElementById:get,querySelectorAll:()=>[]};
const sandbox={document,window:{addEventListener(){}},URL};
vm.createContext(sandbox);vm.runInContext(SOURCE,sandbox);
const run=source=>vm.runInContext(source,sandbox);
run(`
const a='https://wic12.blogspot.com/', b='https://qevnaxori.blogspot.com/';
REPORT={blogs:[{name:'별셈소',url:a,posts:Array.from({length:27},(_,i)=>({
 title:i===26?'한글 검색 표본':'Sample article '+i,url:a+'2026/11/sample-'+i+'.html',incomingLinks:i%2,internalLinks:1
}))},{name:'Nobody',url:b,posts:[{title:'Photo time',url:b+'2026/11/photo-time.html',incomingLinks:1,internalLinks:1}]}]};
renderPosts();`);
const table=()=>get('posts').innerHTML;
const text=id=>get(id).textContent;
assert.match(text('countLine'),/28 \/ 전체 28개.*1–25/);
assert.equal((table().match(/<tr>/g)||[]).length,25);
assert.equal(get('postPrev').disabled,true);
run('changePostPage(1)');
assert.equal(text('postPageLabel'),'2 / 2페이지');
assert.match(text('countLine'),/26–28/);
assert.match(table(),/한글 검색 표본/);
assert.equal(get('postNext').disabled,true);
run('setPostSearch("검색 한글")');
assert.match(text('countLine'),/1 \/ 전체 28개/);
assert.equal(text('postPageLabel'),'1 / 1페이지');
run('setPostSearch("https://qevnaxori.blogspot.com/2026/11/PHOTO-TIME.html?m=1#section")');
assert.match(table(),/Photo time/);
run('setBlogFilter(a)');
assert.match(table(),/조건에 맞는 글이 없습니다/);
run('clearPostSearch(); setFilter("isolated"); setPostSearch("sample article")');
assert.match(text('countLine'),/13 \/ 전체 27개/);
assert.equal(get('postSearch').focused,true);
run('clearPostSearch(); setFilter("all"); setBlogFilter("all")');
assert.match(text('countLine'),/28 \/ 전체 28개/);
assert.equal(get('postClear').hidden,true);
assert.equal(run('REPORT.blogs[0].posts.length'),27);
'''.replace('SOURCE',json.dumps(script))
        completed=subprocess.run(['node','-e',harness],capture_output=True,text=True)
        self.assertEqual(completed.returncode,0,completed.stderr)


if __name__=='__main__': unittest.main()
