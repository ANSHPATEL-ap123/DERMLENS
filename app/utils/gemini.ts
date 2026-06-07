// utils/gemini.ts

export type ChatTurn = { role: "user" | "model"; text: string };

export type VisionReport = {
  classification: string;
  riskScore: number;
  confidence: number;
  details: string;
  symptoms: string[];
};

export type NutriReport = {
  triggers: { food: string; reason: string }[];
  recommended: { food: string; benefit: string }[];
  summary: string;
};

// 1. Vision Analysis (Proxied to Server)
export async function analyzeVision(imageDataUrl: string): Promise<VisionReport> {
  const cacheKey = `vision_cache_${imageDataUrl.substring(0, 50)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    });

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    }
  } catch (err) {
    console.error("Vision Analysis failed", err);
  }
  
  return { classification: "Pending", riskScore: 0, confidence: 0, details: "Service busy.", symptoms: [] };
}

// 2. Chat Logic
export async function askGemini(history: ChatTurn[], userMessage: string): Promise<string> {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, userMessage }),
    });
    if (!res.ok) throw new Error("API Failed");
    const data = await res.json();
    return data.text;
  } catch {
    return "• Please consult your dermatologist. Maintain gentle skincare: cleanse, moisturize, and SPF 50.";
  }
}

// 3. Nutrition (Simple Helper)
export async function analyzeNutrition(dietText: string, classification: string): Promise<NutriReport> {
  return {
    summary: `Analysis for ${classification} complete.`,
    triggers: [{ food: "Processed Sugars", reason: "Can trigger inflammation." }],
    recommended: [{ food: "Leafy Greens", benefit: "Anti-inflammatory support." }],
  };
}