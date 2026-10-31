import process from "node:process";

const input = process.env.WORKER_URL;
if (!input) throw new Error("Cloudflare did not return a Worker deployment URL.");
const origin = new URL(input).origin;
if (!origin.startsWith("https://")) throw new Error("Worker URL must be HTTPS.");
if (!new URL(input).hostname.endsWith(".workers.dev")) {
  throw new Error("Expected an account workers.dev deployment URL; configure the site manually if a custom domain is used.");
}
let last = "";
for (let attempt=0;attempt<8;attempt++) {
  try {
    const response=await fetch(origin+"/api/health",{signal:AbortSignal.timeout(8000)});
    const body=await response.json();
    if (response.ok && body.status==="configured") {
      console.log("Image Worker health verified: "+origin);
      process.exit(0);
    }
    last="HTTP "+response.status+" ("+String(body.status||"unknown")+")";
  } catch(error) { last=String(error?.message||error); }
  if (attempt<7) await new Promise(resolve=>setTimeout(resolve,1600));
}
throw new Error("Image Worker not ready: "+last);
