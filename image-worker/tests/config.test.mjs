import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

test("Worker address updates active config, not commented example", () => {
  const dir=mkdtempSync(join(tmpdir(),"bm-r2-config-"));
  try {
    const file=join(dir,"image-upload-config.js");
    writeFileSync(file,
      '/* Example: window.BLOGGER_IMAGE_WORKER_URL = "https://byeolsemso-image-worker.example.workers.dev"; */\n' +
      'window.BLOGGER_IMAGE_WORKER_URL = "";\n'
    );
    const url="https://byeolsemso-image-worker.chldndlf91.workers.dev";
    const script=resolve("scripts/set-editor-worker-url.mjs");
    const cmd=spawnSync(process.execPath,[script],{cwd:dir,
      env:{...process.env,WORKER_URL:url},encoding:"utf8"});
    assert.equal(cmd.status,0,cmd.stderr);
    const output=readFileSync(file,"utf8");
    assert.match(output,/^window\.BLOGGER_IMAGE_WORKER_URL = "https:\/\/byeolsemso-image-worker\.chldndlf91\.workers\.dev";$/m);
    assert.match(output,/\* Example: window\.BLOGGER_IMAGE_WORKER_URL = "https:\/\/byeolsemso-image-worker\.example\.workers\.dev"; \*/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
