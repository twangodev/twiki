import { QuartzTransformerPlugin } from "../types"
import { slugTag } from "../../util/path"

export interface Options {
  enabled: boolean
  excludePaths?: string[]
  customMapping?: Record<string, string>
}

const defaultOptions: Options = {
  enabled: true,
  excludePaths: [],
  customMapping: {},
}

interface TagStrategy {
  tag: string
  scope: "global" | "immediate" // global applies to all descendants, immediate only to direct children
}

function extractCourseCode(directory: string): string {
  return directory.includes("-") ? directory.substring(directory.lastIndexOf("-") + 1) : directory
}

function extractTerm(directory: string): string | null {
  return directory.includes("-") ? directory.substring(0, directory.indexOf("-")) : null
}

function extractSubject(courseCode: string): string | null {
  const match = courseCode.match(/^[a-z]+/i)
  return match ? match[0] : null
}

function generateTagStrategies(
  directory: string,
  customMapping?: Record<string, string>,
): TagStrategy[] {
  const strategies: TagStrategy[] = []
  const courseCode = customMapping?.[directory] || extractCourseCode(directory)

  // Course code tag is global - applies to all nested content
  strategies.push({ tag: slugTag(courseCode), scope: "global" })

  // Term tag only applies to immediate children
  const term = extractTerm(directory)
  if (term) {
    strategies.push({ tag: slugTag(term), scope: "immediate" })
  }

  // Subject tag only applies to immediate children
  const subject = extractSubject(courseCode)
  if (subject && subject !== courseCode) {
    strategies.push({ tag: slugTag(subject), scope: "immediate" })
  }

  return strategies
}

export const AutoTag: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "AutoTag",
    markdownPlugins() {
      return [
        () => {
          return (_tree, file) => {
            if (!opts.enabled) return

            const relativePath = file.data.relativePath as string | undefined
            if (!relativePath) return

            const pathSegments = relativePath.split("/")
            if (pathSegments.length < 2) return

            const firstDir = pathSegments[0]
            if (opts.excludePaths?.includes(firstDir)) return

            // Check if this is an immediate child (only 2 segments) or nested deeper
            const isImmediateChild = pathSegments.length === 2

            // Generate tag strategies for this directory
            const strategies = generateTagStrategies(firstDir, opts.customMapping)

            // Filter strategies based on scope
            const applicableTags = strategies
              .filter((s) => s.scope === "global" || (s.scope === "immediate" && isImmediateChild))
              .map((s) => s.tag)

            // Initialize frontmatter if needed
            if (!file.data.frontmatter) {
              file.data.frontmatter = { title: "" }
            }

            // Add new tags to existing ones
            const existingTags = (file.data.frontmatter.tags as string[]) || []
            const newTags = applicableTags.filter((tag) => !existingTags.includes(tag))
            file.data.frontmatter.tags = [...existingTags, ...newTags]
          }
        },
      ]
    },
  }
}
