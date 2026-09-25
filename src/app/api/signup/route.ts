09:29:39.701 Running build in Washington, D.C., USA (East) – iad1
09:29:39.702 Build machine configuration: 2 cores, 8 GB
09:29:39.913 Cloning github.com/opalmanicurestudio-hub/studio (Branch: main, Commit: c850ef5)
09:29:41.823 Cloning completed: 1.908s
09:29:45.198 Restored build cache from previous deployment (566svQrLkVeuPGr3PiqhpEBe1sBy)
09:29:50.185 Running "vercel build"
09:29:50.207 Vercel CLI 59.25.4
09:29:51.350 Installing dependencies...
09:29:58.620 
09:29:58.623 up to date in 7s
09:29:58.623 
09:29:58.624 111 packages are looking for funding
09:29:58.624   run `npm fund` for details
09:29:58.624 npm warn install-scripts 4 packages have install scripts not yet covered by allowScripts:
09:29:58.624 npm warn install-scripts   @firebase/util@1.12.0 (postinstall: node ./postinstall.js)
09:29:58.624 npm warn install-scripts   esbuild@0.25.10 (postinstall: node install.js)
09:29:58.624 npm warn install-scripts   protobufjs@7.5.4 (postinstall: node scripts/postinstall)
09:29:58.624 npm warn install-scripts   sharp@0.34.5 (install: node install/check.js || npm run build)
09:29:58.625 npm warn install-scripts
09:29:58.625 npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
09:29:58.702 Detected Next.js version: 15.5.9
09:29:58.715 Running "npm run build"
09:29:58.863 
09:29:58.863 > nextn@0.1.0 build
09:29:58.863 > NODE_ENV=production next build
09:29:58.863 
09:30:00.909    ▲ Next.js 15.5.9
09:30:00.911 
09:30:01.048    Creating an optimized production build ...
09:30:42.181 Failed to compile.
09:30:42.183 
09:30:42.184 ./src/app/api/signup/route.ts
09:30:42.184 Error:   x Expected '>', got 'className'
09:30:42.184      ,-[/vercel/path0/src/app/api/signup/route.ts:109:1]
09:30:42.184  106 | 
09:30:42.185  107 |   // ── Building ──
09:30:42.185  108 |   if (building >= 0) return (
09:30:42.185  109 |     <div className="flex min-h-dvh items-center justify-center px-5">
09:30:42.185      :          ^^^^^^^^^
09:30:42.185  110 |       <div className="w-full max-w-sm text-center">
09:30:42.185  111 |         <p className="text-3xl font-light tracking-tight">Building <span className="font-semibold">your ClarityFlow</span></p>
09:30:42.186  112 |         <div className="glass mt-8 space-y-3 rounded-[2rem] p-6 text-left">
09:30:42.186      `----
09:30:42.186 
09:30:42.186 Caused by:
09:30:42.186     Syntax Error
09:30:42.186 
09:30:42.186 Import trace for requested module:
09:30:42.186 ./src/app/api/signup/route.ts
09:30:42.186 
09:30:42.197 
09:30:42.198 > Build failed because of webpack errors
09:30:42.282 Error: Command "npm run build" exited with 1
