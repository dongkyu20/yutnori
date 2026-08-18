import { z } from "zod";
import type { ClientCommand } from "./protocol";
export const normalizeNickname = (value: string) => value.trim().replace(/\s+/g, " ");
export const nicknameSchema = z
  .string()
  .transform(normalizeNickname)
  .pipe(z.string().min(2).max(12).regex(/^[A-Za-z\uAC00-\uD7A3]+$/));
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
const versioned = { roomVersion: z.number().int().nonnegative(), requestId: z.string().uuid() };
export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CREATE_ROOM"), nickname: nicknameSchema, mode: z.enum(["individual", "team"]) }).strict(),
  z.object({ type: z.literal("JOIN_ROOM"), nickname: nicknameSchema, roomCode: roomCodeSchema }).strict(),
  z.object({ type: z.literal("SET_READY"), ready: z.boolean(), ...versioned }).strict(),
  z.object({ type: z.literal("ASSIGN_TEAM"), playerId: z.string().uuid(), teamId: z.enum(["A", "B", "C", "D"]), ...versioned }).strict(),
  z.object({ type: z.literal("KICK_PLAYER"), playerId: z.string().uuid(), ...versioned }).strict(),
  z.object({ type: z.literal("LEAVE_ROOM"), ...versioned }).strict(),
  z.object({ type: z.literal("CHOOSE_COLOR"), slot: z.number().int().min(0).max(3), ...versioned }).strict(),
  z.object({ type: z.literal("START_GAME"), ...versioned }).strict(),
  z.object({ type: z.literal("PLAY_AGAIN"), ...versioned }).strict(),
  z.object({ type: z.literal("THROW_YUT"), ...versioned }).strict(),
  z.object({ type: z.literal("SELECT_PIECE"), throwId: z.string().min(1), pieceId: z.string().min(1), ...versioned }).strict(),
  z.object({ type: z.literal("SELECT_ROUTE"), routeId: z.string().min(1), ...versioned }).strict(),
  z.object({ type: z.literal("REACT"), emoji: z.enum(["\uD83D\uDC4F", "\uD83D\uDD25", "\uD83D\uDE2E", "\uD83C\uDF89"]) }).strict(),
]);
export const parseClientCommand = (raw: unknown): z.ZodSafeParseResult<ClientCommand> =>
  clientCommandSchema.safeParse(raw);
