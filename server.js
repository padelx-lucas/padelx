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
                <a href="https://www.padelx.fr" style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 28px;font-size:11px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;">Retour à la boutique →</a>
              </div>
              <div style="padding:16px 36px;border-top:1px solid #eee;font-size:11px;color:#aaa;">© 2025 Padel X — padelx.fr</div>
            </div>
          </body></html>`
        });
        console.log('Email envoyé à ' + clientEmail);
      }
    }
  } catch(e) {
    console.error('Erreur success:', e.message);
  }

  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><title>Merci — PADEL X</title><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap" rel="stylesheet"/><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#f5f4f0;font-family:'Oswald',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}.box{background:#fff;border-top:4px solid #D0021B;padding:60px 48px;text-align:center;max-width:520px;width:100%;margin:20px;}.check{font-size:64px;margin-bottom:24px;}h1{font-size:52px;font-weight:700;text-transform:uppercase;letter-spacing:-2px;margin-bottom:12px;}h1 span{color:#D0021B;}p{font-size:14px;color:#888;line-height:1.8;margin-bottom:32px;font-family:Arial,sans-serif;}a{display:inline-block;background:#0a0a0a;color:#fff;padding:14px 32px;font-size:12px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;}a:hover{background:#D0021B;}</style></head><body><div class="box"><div class="check">✅</div><h1>Merci <span>!</span></h1><p>Ta commande est confirmée.<br/>Un email de confirmation t'a été envoyé.<br/>Livraison sous 7 jours maximum.</p><a href="/">← Retour à la boutique</a></div></body></html>`);
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
