import process from "node:process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const value=process.env.WORKER_URL;
if (!value) throw new Error("Cloudflare Worker deployment-url was empty");
const url=new URL(value);
if (url.protocol!=="https:" || !url.hostname.endsWith(".workers.dev")) {
  throw new Error("Only a verified workers.dev deployment URL can be committed automatically.");
}
if(!url.hostname.startsWith("byeolsemso-image-worker.")){
  throw new Error("Unexpected Cloudflare worker hostname: "+url.hostname);
}
const urlBase=url.origin;
const file=resolve("image-upload-config.js");
const content=readFileSync(file,"utf8");
const pattern=/^window\.BLOGGER_IMAGE_WORKER_URL\s*=\s*["'][^"']*["']\s*;/m;
if (!pattern.test(content)) throw new Error("Missing image Worker URL setting in image-upload-config.js");
const updated=content.replace(pattern,'window.BLOGGER_IMAGE_WORKER_URL = "'+urlBase+'";');
writeFileSync(file,updated,"utf8");
console.log("Blogger editor Worker URL updated: "+urlBase);
