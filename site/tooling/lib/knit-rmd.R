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
# Worksheets often include setup instructions for their interactive session.
# Builds use packages provisioned beforehand, without updating shared libraries.
# This binding applies to unqualified worksheet calls, not utils::install.packages.
worksheet <- new.env(parent = globalenv())
worksheet$install.packages <- function(pkgs, lib = .libPaths(), ...) {
  if (missing(pkgs) || !is.character(pkgs) || anyNA(pkgs) ||
      any(!grepl("^[A-Za-z][A-Za-z0-9.]*$", pkgs))) {
    stop("Worksheet package setup requires names of preinstalled R packages.", call. = FALSE)
  }
  available <- rownames(utils::installed.packages(lib.loc = lib))
  missing_packages <- setdiff(pkgs, available)
  if (length(missing_packages)) {
    stop(paste0(
      "Missing preinstalled R packages: ", paste(missing_packages, collapse = ", "),
      ". Install worksheet dependencies in the build environment before rendering; ",
      "worksheet package installation is disabled."
    ), call. = FALSE)
  }
  invisible(NULL)
}
knit(input, output = output, envir = worksheet, quiet = TRUE)
