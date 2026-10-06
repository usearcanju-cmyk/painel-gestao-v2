export default async function handler(req, res) {
  if (req.query.key !== process.env.APP_KEY) return res.status(401).json({ erro: "chave errada" });
  const token = process.env.META_TOKEN;
  const v = "https://graph.facebook.com/v21.0";
  if (req.query.acao !== "convidar") {
    const me = await fetch(`${v}/me?fields=id,name&access_token=${token}`).then(r => r.json());
    const perms = await fetch(`${v}/me/permissions?access_token=${token}`).then(r => r.json());
    return res.json({ me, perms });
  }
  const body = new URLSearchParams({ email: req.query.email, role: "ADMIN", access_token: token });
  const r = await fetch(`${v}/1847783065821567/business_users`, { method: "POST", body });
  res.json(await r.json());
}
