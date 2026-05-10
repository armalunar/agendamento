import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { verifyAdminRequest } from "@/lib/adminGuard";
import { applyChatLifecycle, buildChatConversationSummary, normalizeChatConversation } from "@/lib/chatShared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await verifyAdminRequest(request);

    const limit = Math.min(120, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 60)));
    const snap = await adminDb.collection("supportChats").orderBy("lastMessageAt", "desc").limit(limit).get();
    const batch = adminDb.batch();
    let hasPendingChanges = false;
    const chats = snap.docs.map((doc) => {
      const lifecycle = applyChatLifecycle(normalizeChatConversation(doc.id, doc.data()));

      if (lifecycle.changed) {
        batch.set(doc.ref, lifecycle.conversation, { merge: true });
        hasPendingChanges = true;
      }

      return buildChatConversationSummary(lifecycle.conversation);
    });

    if (hasPendingChanges) {
      await batch.commit();
    }

    return NextResponse.json({ chats });
  } catch {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 401 });
  }
}
