const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path     = require('path');
const fs       = require('fs');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) res.sendFile(p1);
  else res.sendFile(p2);
});

app.get('/api/config', (req, res) => {
  res.json({ stripePublicKey: process.env.STRIPE_PUBLIC_KEY || '', baseUrl: process.env.BASE_URL || '' });
});

// PRODUITS
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/products', async (req, res) => {
  const { data, error } = await supabase.from('products').insert([req.body]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.put('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase.from('products').update(req.body).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.delete('/api/products/:id', async (req, res) => {
  const { error } = await supabase.from('products').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// NEWS
app.get('/api/news', async (req, res) => {
  const { data, error } = await supabase.from('news').select('*').order('created_at', { ascending: false }).limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/news/generer', async (req, res) => {
  await genererActus();
  const { data } = await supabase.from('news').select('*').order('created_at', { ascending: false }).limit(10);
  res.json({ success: true, news: data });
});

// CONSEILS
app.get('/api/conseils', async (req, res) => {
  const { data, error } = await supabase.from('conseils').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/conseils', async (req, res) => {
  const { data, error } = await supabase.from('conseils').insert([req.body]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.delete('/api/conseils/:id', async (req, res) => {
  const { error } = await supabase.from('conseils').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ROBOT IA
async function genererActus() {
  console.log('Robot IA : génération des actus...');
  try {
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Tu es rédacteur pour Padel X, boutique padel premium française. Aujourd'hui : ${today}. Génère 4 actualités padel courtes et variées. Réponds UNIQUEMENT en JSON valide sans markdown : [{"title":"titre","content":"2-3 phrases.","category":"Tournoi"},{"title":"...","content":"...","category":"Matériel"},{"title":"...","content":"...","category":"Conseil"},{"title":"...","content":"...","category":"Tendance"}]`
      }]
    });
    const actus = JSON.parse(msg.content[0].text.trim());
    await supabase.from('news').delete().lt('created_at', new Date(Date.now() - 25 * 3600000).toISOString());
    for (const actu of actus) await supabase.from('news').insert([actu]);
    console.log(`OK : ${actus.length} actus générées`);
  } catch (e) {
    console.error('Erreur actus:', e.message);
  }
}

function scheduleCron() {
  const now = new Date();
  const next7 = new Date();
  next7.setHours(7, 0, 0, 0);
  if (next7 <= now) next7.setDate(next7.getDate() + 1);
  const delay = next7 - now;
  console.log(`Prochaines actus dans ${Math.round(delay / 60000)} minutes`);
  setTimeout(() => { genererActus(); setInterval(genererActus, 86400000); }, delay);
}

// STRIPE
app.post('/create-checkout', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Panier vide' });
    const BASE = process.env.BASE_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      locale: 'fr',
      line_items: items.map(item => ({
        price_data: { currency: 'eur', product_data: { name: item.emoji + ' ' + item.name }, unit_amount: item.price },
        quantity: item.qty,
      })),
      shipping_address_collection: { allowed_countries: ['FR', 'BE', 'CH', 'LU', 'MC'] },
      shipping_options: [
        { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 0, currency: 'eur' }, display_name: 'Livraison gratuite', delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 7 } } } },
        { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 490, currency: 'eur' }, display_name: 'Livraison express', delivery_estimate: { minimum: { unit: 'business_day', value: 2 }, maximum: { unit: 'business_day', value: 3 } } } },
      ],
      success_url: `${BASE}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Merci — PADEL X</title><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap" rel="stylesheet"/><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#f5f4f0;font-family:'Oswald',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}.box{background:#fff;border-top:4px solid #D0021B;padding:60px 48px;text-align:center;max-width:520px;width:100%;margin:20px;}.check{font-size:64px;margin-bottom:24px;}h1{font-size:52px;font-weight:700;text-transform:uppercase;letter-spacing:-2px;margin-bottom:12px;}h1 span{color:#D0021B;}p{font-size:14px;color:#888;line-height:1.8;margin-bottom:32px;}a{display:inline-block;background:#0a0a0a;color:#fff;padding:14px 32px;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;}a:hover{background:#D0021B;}</style></head><body><div class="box"><div class="check">✅</div><h1>Merci <span>!</span></h1><p>Ta commande est confirmée.<br/>Tu recevras un email sous peu.<br/>Livraison sous 7 jours maximum.</p><a href="/">← Retour à la boutique</a></div></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PADEL X démarré port ${PORT}`);
  console.log(`Stripe: ${process.env.STRIPE_SECRET_KEY ? 'OK' : 'MANQUANT'}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL ? 'OK' : 'MANQUANT'}`);
  console.log(`Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'MANQUANT'}`);
  scheduleCron();
  supabase.from('news').select('id').limit(1).then(({ data }) => {
    if (!data || data.length === 0) genererActus();
  });
});
