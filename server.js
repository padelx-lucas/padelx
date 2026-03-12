const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Anthropic
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sert les fichiers statiques
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Accueil
app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(p1)) res.sendFile(p1);
  else res.sendFile(p2);
});

// ── Config publique
app.get('/api/config', (req, res) => {
  res.json({
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || '',
    baseUrl: process.env.BASE_URL || ''
  });
});

// ── API PRODUITS ──
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

// ── API NEWS ──
app.get('/api/news', async (req, res) => {
  const { data, error } = await supabase.from('news').select('*').order('created_at', { ascending: false }).limit(10);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── API CONSEILS ──
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

// ── ROBOT IA — Génère les actus du jour ──
async function genererActus() {
  console.log('🤖 Génération des actus padel...');
  try {
    const today = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Tu es le rédacteur du site Padel X, une boutique padel premium française.
Aujourd'hui nous sommes le ${today}.
Génère 4 courtes actualités padel variées (tournois, tendances, conseils, nouveautés matériel, compétitions, astuces).
Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte autour :
[
  {"title": "titre court accrocheur", "content": "2-3 phrases informatives et engageantes.", "category": "Tournoi|Matériel|Conseil|Tendance"},
  ...
]`
      }]
    });

    const raw = msg.content[0].text.trim();
    const actus = JSON.parse(raw);

    // Supprimer les actus d'hier
    await supabase.from('news').delete().lt('created_at', new Date(Date.now() - 24*60*60*1000).toISOString());

    // Insérer les nouvelles
    for (const actu of actus) {
      await supabase.from('news').insert([actu]);
    }
    console.log(`✅ ${actus.length} actus générées`);
  } catch(e) {
    console.error('❌ Erreur génération actus:', e.message);
  }
}

// ── CRON — Chaque matin à 7h ──
function scheduleCron() {
  const now = new Date();
  const next7h = new Date();
  next7h.setHours(7, 0, 0, 0);
  if (next7h <= now) next7h.setDate(next7h.getDate() + 1);
  const delay = next7h - now;
  console.log(`⏰ Prochaines actus dans ${Math.round(delay/1000/60)} minutes`);
  setTimeout(() => {
    genererActus();
    setInterval(genererActus, 24 * 60 * 60 * 1000); // puis toutes les 24h
  }, delay);
}

// Route manuelle pour forcer la génération (admin)
app.post('/api/news/generer', async (req, res) => {
  await genererActus();
  const { data } = await supabase.from('news').select('*').order('created_at', { ascending: false }).limit(10);
  res.json({ success: true, news: data });
});


// ── Créer session Stripe Checkout
app.post('/create-checkout', async (req, res) => {
  try {
    const { items, successUrl, cancelUrl } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Panier vide' });

    const BASE = process.env.BASE_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      locale: 'fr',
      line_items: items.map(item => ({
        price_data: {
          currency: 'eur',
          product_data: { name: item.emoji + '  ' + item.name },
          unit_amount: item.price,
        },
        quantity: item.qty,
      })),
      shipping_address_collection: {
        allowed_countries: ['FR', 'BE', 'CH', 'LU', 'MC'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 0, currency: 'eur' },
            display_name: '🚚 Livraison gratuite',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 490, currency: 'eur' },
            display_name: '⚡ Livraison express',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 3 },
            },
          },
        },
      ],
      success_url: `${BASE}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE}/`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Page succès
app.get('/success', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Commande confirmée — PADEL X</title>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f5f4f0;font-family:'Oswald',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.box{background:#fff;border-top:4px solid #D0021B;padding:60px 48px;text-align:center;max-width:520px;width:100%;margin:20px;}
.check{font-size:64px;margin-bottom:24px;}
h1{font-size:52px;font-weight:700;text-transform:uppercase;letter-spacing:-2px;margin-bottom:12px;}
h1 span{color:#D0021B;}
p{font-size:14px;color:#888;line-height:1.8;margin-bottom:32px;font-family:'Inter',sans-serif;}
a{display:inline-block;background:#0a0a0a;color:#fff;padding:14px 32px;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;transition:background .2s;}
a:hover{background:#D0021B;}
</style>
</head>
<body>
<div class="box">
  <div class="check">✅</div>
  <h1>Merci <span>!</span></h1>
  <p>Ta commande est confirmée et en cours de traitement.<br/>Tu recevras un email de confirmation sous peu.<br/>Livraison sous 7 jours maximum.</p>
  <a href="/">← Retour à la boutique</a>
</div>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ PADEL X server démarré sur le port ${PORT}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? '✓ configuré' : '⚠ clé manquante'}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✓ configuré' : '⚠ clé manquante'}`);
  console.log(`   IA: ${process.env.ANTHROPIC_API_KEY ? '✓ configuré' : '⚠ clé manquante'}`);
  scheduleCron();
  // Générer les actus au démarrage si la table est vide
  supabase.from('news').select('id').limit(1).then(({ data }) => {
    if (!data || data.length === 0) genererActus();
  });
});
});
