import AlchemystAI from "@alchemystai/sdk";





export const runtime = "nodejs";

const client = new AlchemystAI({
  apiKey: process.env.ALCHEMYST_AI_API_KEY
})

// optional of generating the final answer using  OpenAI
const OPENAI_API_KEY = process.env.OPEN_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

function parseRepoUrl(reqoUrl: string) {
  const u = new URL(reqoUrl);
  const [owner, repo] = u.pathname.replace(/^\/+/, "").split("/").slice(0, 2);
  if(!owner || !repo ) throw new Error("Invalid Github URL" )
}