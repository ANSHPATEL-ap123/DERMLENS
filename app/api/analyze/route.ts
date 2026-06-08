import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return NextResponse.json({ error: "Groq Key missing" }, { status: 500 });

  try {
    const { imageDataUrl } = await req.json();
    
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "system",
            content: `You are a Board-Certified Clinical Dermatologist AI. Your task is to analyze the provided skin image and return a highly accurate clinical assessment.

CRITICAL DIAGNOSTIC RULES:
1. DO NOT default to "Acne" simply because you detect red inflammation or spots. 
2. You must strictly analyze surface texture: explicitly look for silvery-white scales/plaques (classic for Psoriasis), honey-colored crusts, open/closed comedones, or fluid-filled pustules.
3. Evaluate the borders: are they well-defined (like Psoriasis or Ringworm) or poorly defined?
4. If the image presents thick, scaly patches over inflamed skin, you must classify it as Psoriasis, not Acne.

Respond ONLY with valid JSON exactly like this:
{"classification": "string", "riskScore": number (MUST be an integer between 1 and 10), "confidence": number, "details": "string", "symptoms": ["string"]}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this skin image and provide the JSON diagnostic." },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Groq API Error");

    const text = data.choices[0].message.content;
    const parsedData = JSON.parse(text);
   
    // If the AI stubbornly returns a decimal (e.g., 0.8), convert it to 8.
    if (parsedData.riskScore <= 1) {
      parsedData.riskScore = Math.round(parsedData.riskScore * 10);
    }
   
    return NextResponse.json(parsedData);
  } catch (err: any) {
    console.error("SERVER ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}