14:52:12.811 Running build in Washington, D.C., USA (East) – iad1
14:52:12.812 Build machine configuration: 2 cores, 8 GB
14:52:12.975 Cloning github.com/opalmanicurestudio-hub/studio (Branch: main, Commit: aaa323f)
14:52:14.439 Cloning completed: 1.464s
14:52:18.498 Restored build cache from previous deployment (2jfFo5HaTzr4tdxDuq1jtDfzisct)
14:52:18.789 Running "vercel build"
14:52:18.818 Vercel CLI 56.2.0
14:52:19.408 Installing dependencies...
14:52:27.380 
14:52:27.381 up to date in 8s
14:52:27.382 
14:52:27.382 111 packages are looking for funding
14:52:27.383   run `npm fund` for details
14:52:27.450 Detected Next.js version: 15.5.9
14:52:27.464 Running "npm run build"
14:52:27.621 
14:52:27.622 > nextn@0.1.0 build
14:52:27.622 > NODE_ENV=production next build
14:52:27.622 
14:52:29.277    ▲ Next.js 15.5.9
14:52:29.278 
14:52:29.395    Creating an optimized production build ...
14:53:24.056  ✓ Compiled successfully in 50s
14:53:24.095    Skipping validation of types
14:53:24.095    Skipping linting
14:53:24.491    Collecting page data ...
14:53:38.538    Generating static pages (0/98) ...
14:53:40.760 Automatic initialization failed. Falling back to firebase config object. Error [FirebaseError]: Firebase: Need to provide options, when not being deployed to hosting via source. (app/no-options).
14:53:40.760     at B (.next/server/chunks/2566.js:33:100468)
14:53:40.760     at <unknown> (.next/server/chunks/1261.js:1:8940)
14:53:40.761     at <unknown> (.next/server/chunks/1261.js:1:9091)
14:53:40.761     at o (.next/server/chunks/1261.js:1:8880) {
14:53:40.761   code: 'app/no-options',
14:53:40.761   customData: {}
14:53:40.761 }
14:53:40.826    Generating static pages (24/98) 
14:53:40.827    Generating static pages (48/98) 
14:53:43.354    Generating static pages (73/98) 
14:53:44.580 Error occurred prerendering page "/booths". Read more: https://nextjs.org/docs/messages/prerender-error
14:53:44.581 ReferenceError: Cannot access 'a5' before initialization
14:53:44.582     at au (.next/server/app/(app)/booths/page.js:2:47766) {
14:53:44.582   digest: '1384489297'
14:53:44.583 }
14:53:44.583 Export encountered an error on /(app)/booths/page: /booths, exiting the build.
14:53:44.598  ⨯ Next.js build worker exited with code: 1 and signal: null
14:53:44.761 Error: Command "npm run build" exited with 1
