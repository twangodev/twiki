import fs from "fs"
import { Repository } from "@napi-rs/simple-git"
import { QuartzTransformerPlugin } from "../types"
import path from "path"
import { styleText } from "util"

interface RepositoryCache {
  repo: Repository
  workdir: string
}

interface SubmoduleInfo {
  path: string
  fullPath: string
}

function parseGitmodules(gitmodulesPath: string): SubmoduleInfo[] {
  try {
    const content = fs.readFileSync(gitmodulesPath, "utf8")
    const submodules: SubmoduleInfo[] = []
    const lines = content.split("\n")
    let currentPath = ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("path = ")) {
        currentPath = trimmed.substring(7).trim()
        if (currentPath) {
          submodules.push({
            path: currentPath,
            fullPath: path.resolve(path.dirname(gitmodulesPath), currentPath)
          })
        }
      }
    }

    // Sort by path length (longest first) for accurate prefix matching
    return submodules.sort((a, b) => b.fullPath.length - a.fullPath.length)
  } catch {
    return []
  }
}

function findSubmoduleForFile(filePath: string, submodules: SubmoduleInfo[]): string | null {
  const resolvedPath = path.resolve(filePath)
  for (const submodule of submodules) {
    if (resolvedPath.startsWith(submodule.fullPath + path.sep) || resolvedPath === submodule.fullPath) {
      return submodule.fullPath
    }
  }
  return null
}

function createRepositoryCache(): Map<string, RepositoryCache> {
  return new Map<string, RepositoryCache>()
}

function getRepositoryForFile(
  filePath: string,
  contentDir: string,
  submodules: SubmoduleInfo[],
  repositoryCache: Map<string, RepositoryCache>
): RepositoryCache | null {
  try {
    const submoduleRoot = findSubmoduleForFile(filePath, submodules)

    if (submoduleRoot) {
      // File is in a submodule
      if (repositoryCache.has(submoduleRoot)) {
        return repositoryCache.get(submoduleRoot)!
      }

      try {
        const repo = Repository.discover(submoduleRoot)
        const workdir = repo.workdir() ?? submoduleRoot
        const repoCache: RepositoryCache = { repo, workdir }
        repositoryCache.set(submoduleRoot, repoCache)
        return repoCache
      } catch {
        return null
      }
    } else {
      // File is in main repository
      const mainKey = "main"
      if (repositoryCache.has(mainKey)) {
        return repositoryCache.get(mainKey)!
      }

      try {
        const repo = Repository.discover(contentDir)
        const workdir = repo.workdir() ?? contentDir
        const repoCache: RepositoryCache = { repo, workdir }
        repositoryCache.set(mainKey, repoCache)
        return repoCache
      } catch {
        return null
      }
    }
  } catch {
    return null
  }
}

export interface Options {
  priority: ("frontmatter" | "git" | "filesystem")[]
}

const defaultOptions: Options = {
  priority: ["frontmatter", "git", "filesystem"],
}

// YYYY-MM-DD
const iso8601DateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/

function coerceDate(fp: string, d: any): Date {
  // check ISO8601 date-only format
  // we treat this one as local midnight as the normal
  // js date ctor treats YYYY-MM-DD as UTC midnight
  if (typeof d === "string" && iso8601DateOnlyRegex.test(d)) {
    d = `${d}T00:00:00`
  }

  const dt = new Date(d)
  const invalidDate = isNaN(dt.getTime()) || dt.getTime() === 0
  if (invalidDate && d !== undefined) {
    console.log(
      styleText(
        "yellow",
        `\nWarning: found invalid date "${d}" in \`${fp}\`. Supported formats: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_time_string_format`,
      ),
    )
  }

  return invalidDate ? new Date() : dt
}

type MaybeDate = undefined | string | number
export const CreatedModifiedDate: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }
  return {
    name: "CreatedModifiedDate",
    markdownPlugins(ctx) {
      return [
        () => {
          const repositoryCache = createRepositoryCache()

          // Parse .gitmodules once during initialization for efficiency
          const gitmodulesPath = path.resolve(ctx.argv.directory, "..", ".gitmodules")
          const submodules = parseGitmodules(gitmodulesPath)

          return async (_tree, file) => {
            let created: MaybeDate = undefined
            let modified: MaybeDate = undefined
            let published: MaybeDate = undefined

            const fp = file.data.relativePath!
            const fullFp = file.data.filePath!
            for (const source of opts.priority) {
              if (source === "filesystem") {
                const st = await fs.promises.stat(fullFp)
                created ||= st.birthtimeMs
                modified ||= st.mtimeMs
              } else if (source === "frontmatter" && file.data.frontmatter) {
                created ||= file.data.frontmatter.created as MaybeDate
                modified ||= file.data.frontmatter.modified as MaybeDate
                published ||= file.data.frontmatter.published as MaybeDate
              } else if (source === "git" && opts.priority.includes("git")) {
                const repoInfo = getRepositoryForFile(fullFp, ctx.argv.directory, submodules, repositoryCache)
                if (repoInfo) {
                  try {
                    const relativePath = path.relative(repoInfo.workdir, fullFp)
                    modified ||= await repoInfo.repo.getFileLatestModifiedDateAsync(relativePath)
                  } catch {
                    console.log(
                      styleText(
                        "yellow",
                        `\nWarning: ${file.data.filePath!} isn't yet tracked by git, dates will be inaccurate`,
                      ),
                    )
                  }
                }
              }
            }

            file.data.dates = {
              created: coerceDate(fp, created),
              modified: coerceDate(fp, modified),
              published: coerceDate(fp, published),
            }
          }
        },
      ]
    },
  }
}

declare module "vfile" {
  interface DataMap {
    dates: {
      created: Date
      modified: Date
      published: Date
    }
  }
}
