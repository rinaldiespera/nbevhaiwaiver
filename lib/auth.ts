import { NextRequest, NextResponse } from "next/server";

function expectedToken(): string | undefined {
  return process.env.API_BEARER_TOKEN;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function badRequestResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFoundResponse(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function validateBearerAuth(req: NextRequest): boolean {
  const want = expectedToken();
  if (!want || want.length < 8) {
    return false;
  }
  const header = req.headers.get("authorization");
  if (!header) return false;
  const firstSpace = header.indexOf(" ");
  if (firstSpace <= 0) return false;
  const scheme = header.slice(0, firstSpace);
  const token = header.slice(firstSpace + 1);
  if (scheme !== "Bearer") return false;
  let acc = 0;
  if (token.length !== want.length) return false;
  for (let i = 0; i < token.length; i++) {
    acc |= token.charCodeAt(i) ^ want.charCodeAt(i);
  }
  return acc === 0;
}
