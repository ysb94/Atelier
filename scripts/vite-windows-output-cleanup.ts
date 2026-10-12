import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Node 24의 Windows 동기 재귀 삭제 충돌을 빌드 출력 폴더에만 우회한다. */
export function windowsOutputCleanupPlugin(): Plugin {
  let config: ResolvedConfig | undefined
  let outputDirectory: string | undefined

  return {
    name: 'atelier:windows-output-cleanup',
    apply: 'build',
    enforce: 'pre',
    configResolved(resolved) {
      if (process.platform !== 'win32' || resolved.isWorker || !resolved.build.write || resolved.build.emptyOutDir === false) return
      const output = path.resolve(resolved.root, resolved.build.outDir)
      // 프로젝트 외부·루트 디렉터리는 Vite의 기존 동작에 맡긴다.
      if (!isInside(path.resolve(resolved.root), output)) return
      // 별도 Rollup 출력 경로가 있으면 Vite의 기존 정리 규칙을 유지한다.
      const outputs = resolved.build.rolldownOptions.output
      if (outputs && (Array.isArray(outputs) ? outputs : [outputs]).some(item => item.dir || item.file)) return
      config = resolved
      outputDirectory = output
      resolved.build.emptyOutDir = false
    },
    renderStart: {
      order: 'pre',
      sequential: true,
      async handler() {
        if (!config || !outputDirectory) return
        try {
          let outputStat
          try {
            outputStat = await lstat(outputDirectory)
          } catch (error) {
            // 첫 빌드에서는 출력 폴더가 아직 존재하지 않는다.
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
            throw error
          }
          if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) throw new Error(`Unsafe build output directory: ${outputDirectory}`)
          const root = await realpath(config.root)
          const output = await realpath(outputDirectory)
          if (!isInside(root, output)) throw new Error(`Build output resolves outside project: ${output}`)
          for (const entry of await readdir(output)) {
            if (entry === '.git') continue
            const target = path.resolve(output, entry)
            if (!isInside(output, target)) throw new Error(`Unsafe build cleanup path: ${target}`)
            await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
          }
        } catch (error) {
          console.error('[build] 출력 폴더 정리 실패', { outputDirectory, error })
          throw error
        }
      },
    },
  }
}
