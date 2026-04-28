export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("URL não informada");
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    const data = await response.text();

    // 🔥 CORS LIBERADO
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    res.status(200).send(data);

  } catch (err) {
    res.status(500).send("Erro no proxy");
  }
}