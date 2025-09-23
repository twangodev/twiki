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

            // Extract the part after the last hyphen
            const extractedName = firstDir.includes("-")
              ? firstDir.substring(firstDir.lastIndexOf("-") + 1)
              : firstDir

            const tagName = opts.customMapping?.[firstDir] || extractedName

            const autoTag = slugTag(tagName)

            if (!file.data.frontmatter) {
              file.data.frontmatter = { title: "" }
            }

            const existingTags = (file.data.frontmatter.tags as string[]) || []

            if (!existingTags.includes(autoTag)) {
              file.data.frontmatter.tags = [...existingTags, autoTag]
            }
          }
        },
      ]
    },
  }
}
