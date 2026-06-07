import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return NextResponse.json({ error: "Groq Key missing" }, { status: 500 });

  try {
    const { history, userMessage } = await req.json();
    
    // Convert your Gemini history format to Groq/OpenAI format
    const formattedHistory = history.map((t: any) => ({
      role: t.role === "model" ? "assistant" : "user",
      content: t.text
    }));

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are DermCure, a cautious dermatology assistant. Keep answers concise." },
          ...formattedHistory,
          { role: "user", content: userMessage }
        ]
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Groq API Error");

    const text = data.choices[0].message.content;
    return NextResponse.json({ text });
  } catch (err: any) {
    console.error("CHAT ERROR:", err.message);
    return NextResponse.json({ error: "Chat crash" }, { status: 500 });
  }
}