
import crypto from "node:crypto";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const secret = process.env.SHARE_LINK_SECRET;

  if (!secret || secret.length < 32) {
    return res.status(500).json({
      error: "Secure sharing is not configured."
    });
  }

  // This endpoint deliberately does not issue links yet.
  // Link creation must be connected to an authenticated,
  // authorized matchmaker workflow before it is enabled.
  return res.status(501).json({
    error: "Share-link creation is not enabled yet."
  });
}
