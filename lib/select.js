const { SourceMapGenerator } = require('source-map')
const { attrsToQuery } = require('./codegen/utils')

// copied from @vue/component-compiler-utils/dist/parse.js
const splitRE = /\r?\n/g
const emptyRE = /^(?:\/\/)?\s*$/

module.exports = function selectBlock (descriptor, loaderContext, query) {
  // template
  if (query.type === `template`) {
    loaderContext.callback(
      null,
      descriptor.template.content,
      descriptor.template.map
    )
    return
  }

  // script
  if (query.type === `script`) {
    // original @vue/component-compiler-utils generates sourcemap with full SFC contents, and also adds incorrect sourceRoot
    // it's probably more logical to map JS inside SFC to the isolated source, since that happens for template and styles
    let blockMap = descriptor.script.map
    if (blockMap) {
      const attrsQuery = attrsToQuery(descriptor.script.attrs, 'js')
      const query = `?vue&type=script${attrsQuery}`

      const filename = loaderContext.resourcePath + query

      const map = new SourceMapGenerator({
        file: filename
      })
      map.setSourceContent(filename, descriptor.script.content)

      descriptor.script.content.split(splitRE).forEach((line, index) => {
        if (!emptyRE.test(line)) {
          map.addMapping({
            source: filename,
            original: {
              line: index + 1,
              column: 0
            },
            generated: {
              line: index + 1,
              column: 0
            }
          })
        }
      })

      blockMap = map.toJSON()
    }

    loaderContext.callback(
      null,
      descriptor.script.content,
      blockMap
    )
    return
  }

  // styles
  if (query.type === `style` && query.index != null) {
    const style = descriptor.styles[query.index]
    loaderContext.callback(
      null,
      style.content,
      style.map
    )
    return
  }

  // custom
  if (query.type === 'custom' && query.index != null) {
    const block = descriptor.customBlocks[query.index]
    loaderContext.callback(
      null,
      block.content,
      block.map
    )
    return
  }
}
