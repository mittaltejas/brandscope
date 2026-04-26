# Brandscope

CPG brand audit tool. Built for ambitious students, junior brand pros, and founders.

## Quick deploy guide (Mac)

### 1. Get the project on your Mac

Unzip the `brandscope.zip` file. You should have a folder structure like:

```
brandscope/
├── index.html
├── netlify.toml
├── README.md
└── netlify/
    └── functions/
        ├── audit.js
        └── chat.js
```

### 2. Push to GitHub

Open Terminal and run these commands one at a time:

```bash
cd ~/Downloads/brandscope        # or wherever you unzipped it
git init
git add .
git commit -m "Initial commit"
```

Now go to github.com → New repository → name it `brandscope` → don't add a README → Create.

GitHub will show you commands. Copy the two lines under "...or push an existing repository". They look like:

```bash
git remote add origin https://github.com/YOUR_USERNAME/brandscope.git
git branch -M main
git push -u origin main
```

Run those in Terminal.

### 3. Deploy to Netlify

1. Go to [app.netlify.com](https://app.netlify.com) and sign in (sign up free if needed)
2. Click "Add new site" → "Import an existing project"
3. Choose GitHub, authorize Netlify, pick your `brandscope` repo
4. Build settings: leave everything as default, click "Deploy site"
5. Wait ~30 seconds for first deploy

### 4. Add your Anthropic API key

This is the critical step — without it, the audit will fail.

1. In your Netlify site dashboard, go to **Site configuration** → **Environment variables**
2. Click "Add a variable"
3. Key: `ANTHROPIC_API_KEY`
4. Value: paste your key (starts with `sk-ant-...`)
5. Save
6. Go to **Deploys** tab → click "Trigger deploy" → "Deploy site" (so the new env var takes effect)

### 5. (Optional) Set the URL

Netlify will give you a random subdomain like `peaceful-otter-12345.netlify.app`. To get `brandscope.netlify.app`:

1. **Site configuration** → **Domain management** → **Options** next to the default URL → **Edit site name**
2. Change to `brandscope` (if available) or another name you like

### Done!

Visit your URL. The full app should work — landing page, form, audit, scenario chat, all running off your API key from the backend. Users never see or need to provide a key.

## How rate limiting works

Each visitor (by IP) can run **2 audits per 24 hours**. After that they see a friendly "come back tomorrow" message.

To change the limit, edit `netlify/functions/audit.js` line 5:
```js
const RATE_LIMIT = 2;
```

## Costs

- **Netlify**: free tier covers way more than you'll need. ~125,000 function calls/month.
- **Anthropic**: roughly $0.05–0.10 per audit, $0.005 per scenario chat message.

If 50 people each run 2 audits/day, that's ~$5–10/day in Anthropic costs. Watch your usage.

## Updating the site

Make changes locally, then in Terminal:

```bash
git add .
git commit -m "what you changed"
git push
```

Netlify will auto-redeploy in about 30 seconds.
