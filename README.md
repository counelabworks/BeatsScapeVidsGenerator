# Beats Scape — URL / vids generator

Guest download site for **`HOSTING.mode = 'vercel'`**.

Local mixer records → uploads to Backblaze → guest QR opens this site → signed play/download URL.

## Page

- Background: `public/img/bgV3.png`
- Brand: `public/img/LOGO_CuriousBeatsXDWP.png`
- IQOS invite → [iqos.com](https://www.iqos.com/)

## Deploy

```bash
cd url-vids-generator
npx vercel
```

Set the same `B2_*` env vars as the main app (see `.env.example`), then put the production URL into root `config.js`:

```js
HOSTING: {
  mode: 'vercel',
  autoFunnel: false,
  downloadBase: 'https://your-deployment.vercel.app',
},
```

Restart `npm start` and regenerate preprint QRs.
