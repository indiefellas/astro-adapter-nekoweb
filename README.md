# astro-adapter-nekoweb
[![indiefellas/astro-adapter-nekoweb](https://img.shields.io/badge/github-astro--adapter--nekoweb-green?style=for-the-badge&logo=github&logoColor=white)](https://github.com/indiefellas/astro-adapter-nekoweb) [![NPM Downloads](https://img.shields.io/npm/dm/@indiefellas/astro-adapter-nekoweb?style=for-the-badge&logo=npm&color=red)](https://www.npmjs.com/package/@indiefellas/astro-adapter-nekoweb)

An adapter for Astro that deploys your app automatically on [Nekoweb](https://nekoweb.org).

Note that this is a community project and is not affiliated with Nekoweb.

## Configuration
To use the adapter, install it:
```
// npm
npm run astro add @indiefellas/astro-adapter-nekoweb
// bun
bun astro add @indiefellas/astro-adapter-nekoweb
```
then add it on your `astro.config.mjs`:
```diff
+ import nekoweb from '@indiefellas/astro-adapter-nekoweb';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()]
  },
  adapter: nekoweb({
    apiKey: 'api key (required)',
    cookie: 'your nekoweb cookie for recently updated support (optional)',
    folder: 'dist'
  })
});
```
then create your API key on https://nekoweb.org/api (Be careful! Don't share this to others as this API can modify your site!) then put the API key on `apiKey`.

if you want your page to go to the recently updated page, get your nekoweb cookie from the devtools and put it on `cookie`! see https://deploy.nekoweb.org/#getting-your-cookie for instructions of how (thanks @thnlqd for helping me implement this!)

and lastly, run `npm run build` or `bun run build` (or anything that can run `astro build`).