import AlchemystAI from '@alchemystai/sdk';
import { NextResponse } from "next/server";
import AdmZip from "adm-zip";


export const runtime = "nodejs";

const client = new AlchemystAI({
    apiKey: process.env.ALCHEMYST_AI_API_KEY,
});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function parseRepoUrl(repoUrl: string) {
    const u = new URL(repoUrl);
    const [owner, repo] = u.pathname.replace(/^\/+/,"").split("/").slice(0,2);
    if (!owner || !repo)  throw new Error("Invalid Github repo URL (expected https://github.com/owner/repo)")
    return { owner, repo };
}

function chunkText(s: string, maxChars = 6000) {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
  return out;
}

//this function tries to guess whether the file buffer is binary ( like an image/zip/exe) instead of a plain text
function isProbablyBinary(buf: Buffer) {
    const slice = buf.subarray(0, Math.min(buf.length, 8192));
    return slice.includes(0);
}

async function downloadZipBall(owner: string, repo: string, ref: string) {

    const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;

    const headers: Record<string, string> = {Accept: "application/vnd.github+json" };
    if(GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    // get redirect
    const r1 = await fetch(url, { headers, redirect: "manual" });
    if (![301, 302, 307, 308].includes(r1.status)) {
        throw new Error(`Github zipball failed ${r1.status}: ${await r1.text()}`);
    }

    const loc = r1.headers.get("location");
    if(!loc) throw new Error("Github zipball: missing Location header");

    //follow , redirect and download zip bytes
    const r2 = await fetch(loc, { redirect: "follow" });
    if(!r2.ok) throw new Error(`Github zip download failed ${r2.status}: ${await r2.text()}`);

    return Buffer.from(await r2.arrayBuffer());
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        if(!body) throw new Error("Invalid JSON body");

        const repoUrl = body.repoUrl as string | undefined;
        const ref = (body.ref as string | undefined) ?? "main";
        if (!repoUrl) throw new Error("Missing repoUrl");

        const { owner, repo } = parseRepoUrl(repoUrl);

        const groupName = [`repo:${owner}/${repo}`, `ref:${ref}`];

        const zipBuf = await downloadZipBall(owner, repo, ref);
        const zip = new AdmZip(zipBuf);

        const allowedExt = /\.(md|txt|ts|tsx|js|jsx|json|yml|yaml|py|go|java|rs|sql|prisma)$/i;

        const documents: { content: string }[] = [];
        let storedFiles = 0;

        for(const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;

            const path = entry.entryName;

            if (
                path.includes("node_modules/") ||
                path.includes("dist/") ||
                path.includes(".next/") ||
                path.endsWith("package-lock.json") ||
                path.endsWith("pnpm-lock.yaml") ||
                path.endsWith("yarn.lock")
            ) continue;

            if (!allowedExt.test(path)) continue;

            const buf = entry.getData();
            if(buf.length > 300_000) continue;
            if(isProbablyBinary(buf)) continue;

            const text = buf.toString("utf-8");
            const blob = `FILE: ${path}\n\n${text}`;

            // chunk so each doc isn't huge
            for (const chunk of chunkText(blob)) documents.push({ content: chunk });

            storedFiles++;
            if (storedFiles >= 250) break;
        }
        await client.v1.context.add({
            documents,
            context_type: 'resource',
            source: 'github-zipball',
            scope: 'internal',
            metadata: {
            fileName: `${owner}-${repo}-${ref}.txt`,
            fileType: 'text/plain',
            lastModified: new Date().toISOString(),
            fileSize: documents.length,
            groupName
        },
    });
    return NextResponse.json({ ok: true, owner, repo, ref, storedFiles, storedChunks: documents.length });
    } 
    catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
    }
}

