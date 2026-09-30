/** 조직도 팀 표시와 같은 여섯 가지 차분한 톤. 프로필 id로 고정한다. */
const CHAT_AVATAR_TONES = [
  'bg-[#f1e7d6] text-[#7a5a2b]',
  'bg-[#e1ece4] text-[#2f6b4f]',
  'bg-[#e3e7f2] text-[#3d4a78]',
  'bg-[#f3e1e0] text-[#9a3f3c]',
  'bg-[#ebe3f1] text-[#5d4a7a]',
  'bg-[#dfecee] text-[#2d6470]',
] as const

export function chatAvatarTone(profileId: string): string {
  let hash = 0
  for (let index = 0; index < profileId.length; index += 1) {
    hash = (hash * 31 + profileId.charCodeAt(index)) >>> 0
  }
  return CHAT_AVATAR_TONES[hash % CHAT_AVATAR_TONES.length] ?? CHAT_AVATAR_TONES[0]
}
