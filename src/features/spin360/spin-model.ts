/** 배포 코드·화면·검수 기록이 같은 모델과 고정 revision을 사용한다. */
export const SPIN_AI_MODEL = {
  name: 'BiRefNet_lite 512', id: 'studioludens/birefnet-lite-512',
  revision: '962e67969ec6acec9c19fab76acee4f5e22e990c',
  runtime: 'Transformers.js 3.8.1', device: 'CPU(WASM) · 브라우저 로컬', precision: 'FP32',
  target: { name: 'SlimSAM-77 (제품 선택)', id: 'Xenova/slimsam-77-uniform', revision: '5850ab45f587c112167512ffef949107115e26a0', precision: 'Q8' },
} as const
