args <- commandArgs(trailingOnly = TRUE)
input <- normalizePath(args[[1]])
output <- args[[2]]
figures <- args[[3]]

library(knitr)
render_markdown()
opts_knit$set(root.dir = dirname(input))
opts_chunk$set(dev = "png", fig.path = paste0(figures, "/"), error = FALSE, cache = FALSE)
# Keep plots as Markdown even when a worksheet sets HTML/PDF sizing options.
# The site renderer handles typography, math, and responsive image sizing.
knit_hooks$set(plot = function(x, options) {
  caption <- if (is.null(options$fig.cap)) paste("Plot from", options$label) else options$fig.cap
  caption <- gsub("[\r\n]", " ", paste(caption, collapse = " "))
  paste0("\n\n![", caption, "](", x, ")\n\n")
})
set.seed(1)
knit(input, output = output, envir = new.env(parent = globalenv()), quiet = TRUE)
