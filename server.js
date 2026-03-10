const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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

// ── Config publique (clé Stripe publique)
app.get('/api/config', (req, res) => {
  res.json({
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || '',
    baseUrl: process.env.BASE_URL || ''
  });
});



// GET tous les produits
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST ajouter un produit
app.post('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .insert([req.body])
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// PUT modifier un produit
app.put('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .update(req.body)
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// DELETE supprimer un produit
app.delete('/api/products/:id', async (req, res) => {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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
});
