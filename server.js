const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path     = require('path');
const fs       = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const multer   = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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

// UPLOAD IMAGE
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Aucun fichier' });
    const ext = file.mimetype.split('/')[1];
    const filename = `product_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('images')
      .upload(filename, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) return res.status(500).json({ error: error.message });
    const { data } = supabase.storage.from('images').getPublicUrl(filename);
    res.json({ url: data.publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// PACKS
app.get('/api/packs', async (req, res) => {
  const { data, error } = await supabase.from('packs').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/packs', async (req, res) => {
  const { data, error } = await supabase.from('packs').insert([req.body]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.put('/api/packs/:id', async (req, res) => {
  const { data, error } = await supabase.from('packs').update(req.body).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.delete('/api/packs/:id', async (req, res) => {
  const { error } = await supabase.from('packs').delete().eq('id', req.params.id);
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

// ROBOT ACTUS — Système de rotation gratuit
const ACTUS_POOL = [
  { title: "Le padel, sport le plus pratiqué en France ?", content: "Le padel continue sa montée en puissance avec plus de 300 000 licenciés en France. Les clubs se multiplient partout sur le territoire, notamment dans les grandes villes. Un phénomène qui ne montre aucun signe de ralentissement.", category: "Tendance" },
  { title: "Bullpadel dévoile sa nouvelle gamme 2025", content: "La marque espagnole Bullpadel frappe fort cette année avec une collection entièrement repensée. Nouvelles technologies de cadre, grips améliorés et designs exclusifs au programme. Les précommandes sont déjà ouvertes.", category: "Matériel" },
  { title: "Comment améliorer son service au padel ?", content: "Le service est souvent négligé par les joueurs débutants et intermédiaires. Pourtant, un bon service peut faire toute la différence dans un match. Travaillez votre placement, la rotation de la balle et variez les angles.", category: "Conseil" },
  { title: "World Padel Tour : les résultats du week-end", content: "Le circuit professionnel de padel a livré des rencontres spectaculaires ce week-end. Les têtes de série ont confirmé leur domination mais quelques surprises sont venues pimenter la compétition. Rendez-vous au prochain tournoi.", category: "Tournoi" },
  { title: "Head lance la raquette Alpha Motion Pro", content: "Head continue d'innover avec la Alpha Motion Pro, conçue pour les joueurs de niveau intermédiaire à avancé. Son cadre en carbone 100% offre puissance et contrôle. Disponible en édition limitée.", category: "Matériel" },
  { title: "Padel et tennis : quelles différences ?", content: "Beaucoup de joueurs de tennis se tournent vers le padel. Si les deux sports partagent certaines bases, les stratégies et les techniques sont très différentes. Les murs changent tout à la tactique de jeu.", category: "Conseil" },
  { title: "Tournoi Open de Paris : inscriptions ouvertes", content: "Le prestigieux Open de Paris ouvre ses inscriptions pour toutes les catégories. Amateur ou confirmé, il y a une place pour tout le monde. Les matchs se dérouleront sur les courts couverts du Stade de France.", category: "Tournoi" },
  { title: "Adidas présente ses nouvelles chaussures padel", content: "Adidas dévoile sa collection de chaussures dédiées au padel pour la saison 2025. Grip renforcé, amorti optimisé et look premium au programme. Parfaites pour les surfaces synthétiques et le gazon artificiel.", category: "Matériel" },
  { title: "5 erreurs à éviter au padel quand on débute", content: "Se précipiter au filet, frapper trop fort, négliger la défense... Les débutants font souvent les mêmes erreurs. En les corrigeant rapidement, vous progresserez bien plus vite et prendrez plus de plaisir sur le court.", category: "Conseil" },
  { title: "Le padel féminin en pleine explosion", content: "La pratique du padel féminin explose en France avec une augmentation de 40% de licenciées en un an. Les clubs ouvrent des créneaux dédiés et les compétitions féminines attirent de plus en plus de participantes.", category: "Tendance" },
  { title: "Nox présente la raquette Luxury Carbon 2025", content: "Nox, marque de référence dans le monde du padel, sort sa nouvelle Luxury Carbon. Conçue avec les meilleurs matériaux, elle offre une précision redoutable et une puissance de frappe exceptionnelle.", category: "Matériel" },
  { title: "Comment choisir sa raquette de padel ?", content: "Ronde, larme ou diamant ? Le choix de la forme dépend de votre niveau et de votre style de jeu. Les débutants privilégient la forme ronde pour sa facilité de prise en main. Les avancés optent pour le diamant pour sa puissance.", category: "Conseil" },
  { title: "Championnat de France de Padel : les qualifiés", content: "Les phases de qualification du Championnat de France de Padel touchent à leur fin. Les meilleures équipes de chaque région s'affrontent pour décrocher leur billet pour la finale nationale. Le niveau est exceptionnel cette année.", category: "Tournoi" },
  { title: "Le padel s'installe dans les stations de ski", content: "Nouvelle tendance : les courts de padel font leur apparition dans les stations de ski. Une façon originale de pratiquer son sport favori en altitude. Plusieurs stations alpines ont déjà investi dans des infrastructures dédiées.", category: "Tendance" },
  { title: "Wilson Ultra Team V2 : test et avis", content: "On a testé la nouvelle Wilson Ultra Team V2, et le moins qu'on puisse dire c'est qu'elle tient ses promesses. Excellent rapport qualité-prix, bonne tolérance aux frappes décentrées et design sobre et élégant.", category: "Matériel" },
  { title: "Améliorer sa volée au padel : nos astuces", content: "La volée est un coup fondamental au padel. Pour la maîtriser, travaillez votre placement au filet, gardez la raquette haute et anticipez la trajectoire de la balle. La régularité prime sur la puissance.", category: "Conseil" },
];

async function genererActus() {
  console.log('Robot : rotation des actus padel...');
  try {
    // Choisir 4 actus différentes selon le jour
    const dayIndex = new Date().getDate();
    const selected = [];
    for (let i = 0; i < 4; i++) {
      selected.push(ACTUS_POOL[(dayIndex + i * 4) % ACTUS_POOL.length]);
    }

    // Supprimer les vieilles actus
    await supabase.from('news').delete()
      .lt('created_at', new Date(Date.now() - 25 * 3600000).toISOString());

    // Insérer les nouvelles
    for (const actu of selected) {
      await supabase.from('news').insert([actu]);
    }
    console.log(`OK : ${selected.length} actus publiées`);
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
      allow_promotion_codes: true,
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

app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  let clientNom = '';
  try {
    if (session_id) {
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['line_items', 'customer_details']
      });
      clientNom = session.customer_details?.name || '';
      const clientEmail = session.customer_details?.email || '';
      const produits = session.line_items?.data || [];
      const montant = (session.amount_total || 0) / 100;

      // Sauvegarder dans Supabase
      await supabase.from('commandes').upsert([{
        id: 'cmd_' + Date.now(),
        stripe_session_id: session_id,
        client_email: clientEmail,
        client_nom: clientNom,
        adresse_livraison: session.shipping_details || {},
        produits: produits,
        montant_total: montant,
        statut: 'confirmée'
      }]);

      // Envoyer email
      if (clientEmail) {
        const lignes = produits.map(item => `
          <tr>
            <td style="padding:10px;border-bottom:1px solid #eee;font-size:13px;">${item.description}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:center;font-size:13px;">${item.quantity}</td>
            <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;font-size:13px;">${((item.amount_total||0)/100).toFixed(2).replace('.',',')} €</td>
          </tr>`).join('');

        await resend.emails.send({
          from: 'Padel X <contact@padelx.fr>',
          to: clientEmail,
          subject: '✅ Commande confirmée — Padel X',
          html: `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,sans-serif;">
            <div style="max-width:560px;margin:40px auto;background:#fff;border-top:4px solid #D0021B;">
              <div style="background:#0a0a0a;padding:28px 36px;">
                <span style="font-family:Arial Black,Arial;font-size:22px;font-weight:900;letter-spacing:4px;color:#fff;">PADEL<span style="color:#D0021B;">X</span></span>
              </div>
              <div style="padding:36px;">
                <h1 style="font-family:Arial Black,Arial;font-size:28px;font-weight:900;text-transform:uppercase;color:#0a0a0a;margin-bottom:8px;">Merci ${clientNom} !</h1>
                <p style="color:#888;font-size:13px;line-height:1.8;margin-bottom:24px;">Ta commande est confirmée. Tu recevras tes produits sous <strong>7 jours maximum</strong>.</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
                  <thead><tr style="background:#0a0a0a;">
                    <th style="padding:10px;text-align:left;color:#fff;font-size:11px;">PRODUIT</th>
                    <th style="padding:10px;text-align:center;color:#fff;font-size:11px;">QTÉ</th>
                    <th style="padding:10px;text-align:right;color:#fff;font-size:11px;">PRIX</th>
                  </tr></thead>
                  <tbody>${lignes}</tbody>
                  <tfoot><tr>
                    <td colspan="2" style="padding:12px 10px;font-weight:bold;">Total</td>
                    <td style="padding:12px 10px;text-align:right;font-size:18px;font-weight:900;color:#D0021B;">${montant.toFixed(2).replace('.',',')} €</td>
                  </tr></tfoot>
                </table>
                <p style="font-size:12px;color:#888;margin-bottom:24px;">Une question ? Contacte-nous à <strong>alxdlucaspro1@gmail.com</strong></p>
                <a href="https://www.padelx.fr/suivi?id=${session_id}" style="display:inline-block;background:#f5a623;color:#fff;padding:12px 28px;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;margin-bottom:10px;">📦 Suivre ma commande →</a><br/><br/><a href="https://www.padelx.fr" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 28px;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;">Retour à la boutique →</a>
              </div>
              <div style="padding:16px 36px;border-top:1px solid #eee;font-size:11px;color:#aaa;">© 2025 Padel X — padelx.fr</div>
            </div>
          </body></html>`
        });
        console.log('Email envoyé à ' + clientEmail);

        // Email de notification pour toi
        await resend.emails.send({
          from: 'Padel X <contact@padelx.fr>',
          to: 'alxdlucaspro1@gmail.com',
          subject: '🛒 Nouvelle commande — ' + montant.toFixed(2).replace('.', ',') + ' €',
          html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px;background:#f5f4f0;">
            <div style="max-width:500px;margin:0 auto;background:#fff;border-top:4px solid #D0021B;padding:28px;">
              <h2 style="font-family:Arial Black,Arial;font-size:22px;text-transform:uppercase;color:#0a0a0a;margin-bottom:16px;">🛒 Nouvelle commande !</h2>
              <p style="font-size:13px;color:#555;margin-bottom:16px;"><strong>Client :</strong> ${clientNom} (${clientEmail})</p>
              <p style="font-size:13px;color:#555;margin-bottom:16px;"><strong>Montant :</strong> <span style="color:#D0021B;font-size:18px;font-weight:900;">${montant.toFixed(2).replace('.', ',')} €</span></p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                ${lignes}
              </table>
              <a href="https://dashboard.stripe.com/payments" style="display:inline-block;background:#0a0a0a;color:#fff;padding:10px 24px;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;">Voir sur Stripe →</a>
            </div>
          </body></html>`
        });
      }
    }
  } catch(e) {
    console.error('Erreur success:', e.message);
  }

  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Merci — PADEL X</title><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap" rel="stylesheet"/><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#f5f4f0;font-family:'Oswald',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}.box{background:#fff;border-top:4px solid #D0021B;padding:60px 48px;text-align:center;max-width:520px;width:100%;margin:20px;}.check{font-size:64px;margin-bottom:24px;}h1{font-size:52px;font-weight:700;text-transform:uppercase;letter-spacing:-2px;margin-bottom:12px;}h1 span{color:#D0021B;}p{font-size:14px;color:#888;line-height:1.8;margin-bottom:32px;font-family:Arial,sans-serif;}a{display:inline-block;background:#0a0a0a;color:#fff;padding:14px 32px;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;}a:hover{background:#D0021B;}</style></head><body><div class="box"><div class="check">✅</div><h1>Merci <span>!</span></h1><p>Ta commande est confirmée.<br/>Un email de confirmation t'a été envoyé.<br/>Livraison sous 7 jours maximum.</p><a href="/">← Retour à la boutique</a></div></body></html>`);
});

// ══ SUIVI DE COMMANDE ══
app.get('/suivi', async (req, res) => {
  const { id } = req.query;
  let commande = null;
  let erreur = '';

  if (id) {
    const { data } = await supabase.from('commandes').select('*').eq('stripe_session_id', id).single();
    commande = data;
    if (!commande) erreur = 'Commande introuvable. Vérifie ton email de confirmation.';
  }

  const statutColor = { 'confirmée': '#f5a623', 'en préparation': '#3498db', 'expédiée': '#9b59b6', 'livrée': '#27ae60' };
  const statutSteps = ['confirmée', 'en préparation', 'expédiée', 'livrée'];
  const curStep = commande ? statutSteps.indexOf(commande.statut) : -1;

  const produitsHtml = commande?.produits?.map(p => `
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;font-size:13px;">
      <span>${p.description} × ${p.quantity}</span>
      <strong>${((p.amount_total||0)/100).toFixed(2).replace('.',',')} €</strong>
    </div>`).join('') || '';

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Suivi de commande — PADEL X</title>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@300;400;500&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#f5f4f0;font-family:'Inter',sans-serif;min-height:100vh;}
nav{background:#0a0a0a;padding:0 40px;height:60px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-family:'Oswald',sans-serif;font-size:22px;font-weight:700;letter-spacing:4px;color:#fff;text-decoration:none;}
.logo span{color:#D0021B;}
.wrap{max-width:680px;margin:48px auto;padding:0 20px;}
h1{font-family:'Oswald',sans-serif;font-size:36px;font-weight:700;text-transform:uppercase;letter-spacing:-1px;color:#0a0a0a;margin-bottom:8px;}
.sub{font-size:13px;color:#888;margin-bottom:32px;}
.search-box{display:flex;gap:0;margin-bottom:40px;}
.search-box input{flex:1;border:1.5px solid #ddd;padding:14px 18px;font-size:13px;outline:none;border-right:none;}
.search-box input:focus{border-color:#0a0a0a;}
.search-box button{background:#0a0a0a;color:#fff;border:none;padding:14px 24px;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;}
.search-box button:hover{background:#D0021B;}
.erreur{background:#fff5f5;border-left:3px solid #D0021B;padding:14px 18px;font-size:13px;color:#D0021B;margin-bottom:24px;}
.card{background:#fff;border-top:3px solid #D0021B;padding:32px;margin-bottom:20px;}
.card-title{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#888;margin-bottom:16px;}
.statut-badge{display:inline-block;padding:6px 16px;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;color:#fff;background:${commande ? (statutColor[commande.statut]||'#888') : '#888'};}
.steps{display:flex;align-items:center;margin:24px 0;gap:0;}
.step{flex:1;text-align:center;position:relative;}
.step-dot{width:28px;height:28px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}
.step-dot.done{background:#0a0a0a;color:#fff;}
.step-dot.active{background:#D0021B;color:#fff;}
.step-dot.todo{background:#eee;color:#aaa;}
.step-line{position:absolute;top:14px;left:50%;right:-50%;height:2px;z-index:0;}
.step-line.done{background:#0a0a0a;}
.step-line.todo{background:#eee;}
.step:last-child .step-line{display:none;}
.step-label{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#888;margin-top:4px;}
.step-label.active{color:#D0021B;font-weight:600;}
.step-label.done{color:#0a0a0a;}
.info-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;}
.info-label{color:#888;}
.total-row{display:flex;justify-content:space-between;padding:14px 0;font-weight:700;}
.total-val{font-family:'Oswald',sans-serif;font-size:22px;color:#D0021B;}
.back{display:inline-block;background:#0a0a0a;color:#fff;padding:12px 28px;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;margin-top:8px;}
.back:hover{background:#D0021B;}
${commande?.numero_suivi ? `.tracking-box{background:#f0f9f0;border-left:3px solid #27ae60;padding:14px 18px;margin-top:16px;font-size:13px;}` : ''}
</style>
</head>
<body>
<nav>
  <a href="/" class="logo">PADEL<span>X</span></a>
  <span style="color:rgba(255,255,255,.3);font-size:11px;letter-spacing:2px;">SUIVI DE COMMANDE</span>
</nav>
<div class="wrap">
  <h1>Suivi de<br/>commande</h1>
  <p class="sub">Entre ton identifiant de commande reçu par email.</p>

  <form class="search-box" action="/suivi" method="get">
    <input type="text" name="id" placeholder="Identifiant de commande..." value="${id||''}" required/>
    <button type="submit">Rechercher →</button>
  </form>

  ${erreur ? `<div class="erreur">❌ ${erreur}</div>` : ''}

  ${commande ? `
  <div class="card">
    <div class="card-title">Statut de la commande</div>
    <div class="statut-badge">${commande.statut}</div>

    <div class="steps">
      ${statutSteps.map((s, i) => `
        <div class="step">
          <div class="step-line ${i < curStep ? 'done' : 'todo'}"></div>
          <div class="step-dot ${i < curStep ? 'done' : i === curStep ? 'active' : 'todo'}">${i < curStep ? '✓' : i+1}</div>
          <div class="step-label ${i < curStep ? 'done' : i === curStep ? 'active' : ''}">${s}</div>
        </div>`).join('')}
    </div>

    ${commande.numero_suivi ? `
    <div class="tracking-box">
      📦 <strong>Numéro de suivi :</strong> ${commande.numero_suivi}
      ${commande.transporteur ? ` — ${commande.transporteur}` : ''}
    </div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">Informations client</div>
    <div class="info-row"><span class="info-label">Nom</span><strong>${commande.client_nom}</strong></div>
    <div class="info-row"><span class="info-label">Email</span><strong>${commande.client_email}</strong></div>
    ${commande.adresse_livraison?.address ? `
    <div class="info-row">
      <span class="info-label">Adresse</span>
      <strong style="text-align:right;">${commande.adresse_livraison.address.line1||''}<br/>${commande.adresse_livraison.address.postal_code||''} ${commande.adresse_livraison.address.city||''}</strong>
    </div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">Produits commandés</div>
    ${produitsHtml}
    <div class="total-row">
      <span>Total payé</span>
      <span class="total-val">${commande.montant_total?.toFixed(2).replace('.',',')} €</span>
    </div>
  </div>

  <a href="/" class="back">← Retour à la boutique</a>
  ` : `
  <div style="text-align:center;padding:48px;color:#888;font-size:13px;">
    Ton identifiant de commande se trouve dans l'email de confirmation reçu après ton achat.
  </div>`}
</div>
</body>
</html>`);
});

// ══ ADMIN — Mettre à jour le statut d'une commande ══
app.put('/api/commandes/:id', async (req, res) => {
  const { statut, numero_suivi, transporteur } = req.body;
  const { data, error } = await supabase.from('commandes')
    .update({ statut, numero_suivi, transporteur })
    .eq('stripe_session_id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// ══ ADMIN — Liste des commandes ══
app.get('/api/commandes', async (req, res) => {
  const { data, error } = await supabase.from('commandes').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ══ PAGE 404 ══
app.use((req, res) => {
  res.status(404).send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Page introuvable — PADEL X</title>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&family=Inter:wght@400&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#0a0a0a;font-family:'Inter',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;}
.num{font-family:'Oswald',sans-serif;font-size:clamp(120px,25vw,200px);font-weight:700;line-height:1;color:rgba(255,255,255,.04);letter-spacing:-10px;margin-bottom:-40px;}
.num em{font-style:normal;color:#D0021B;opacity:.3;}
.logo{font-family:'Oswald',sans-serif;font-size:24px;font-weight:700;letter-spacing:4px;color:#fff;margin-bottom:24px;}
.logo span{color:#D0021B;}
h1{font-family:'Oswald',sans-serif;font-size:32px;font-weight:700;text-transform:uppercase;letter-spacing:-1px;color:#fff;margin-bottom:12px;}
p{font-size:13px;color:rgba(255,255,255,.35);line-height:1.8;margin-bottom:32px;max-width:360px;}
a{display:inline-block;background:#D0021B;color:#fff;padding:14px 36px;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;margin:4px;transition:background .2s;}
a:hover{background:#b0001a;}
a.outline{background:none;border:1.5px solid rgba(255,255,255,.15);color:rgba(255,255,255,.5);}
a.outline:hover{border-color:#fff;color:#fff;background:none;}
</style>
</head>
<body>
<div class="num">4<em>0</em>4</div>
<div class="logo">PADEL<span>X</span></div>
<h1>Page introuvable</h1>
<p>Cette page n'existe pas ou a été déplacée. Retourne à la boutique pour découvrir notre sélection d'équipements padel.</p>
<a href="/">← Retour à la boutique</a>
<a href="/#prods" class="outline">Voir les produits</a>
</body>
</html>`);
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
