const qs = require('querystring')
const prettier = require('prettier')
const consolidate = require('consolidate')
const loaderUtils = require('loader-utils')
const compiler = require('vue-template-compiler')
const transpile = require('vue-template-es2015-compiler')
const transformAssetUrl = require('./modules/assetUrl')
const transformSrcset = require('./modules/srcset')
const { genTemplateHotReloadCode } = require('../hotReload')

// Loader that compiles raw template into JavaScript functions.
// This is injected by the global pitcher (../pitch) for template
// selection requests initiated from vue files.
// Also handles lang="xxx" pre-processing via consolidate if necessary.
module.exports = function (template) {
  const loaderContext = this
  const query = qs.parse(this.resourceQuery.slice(1))

  // although this is not the main vue-loader, we can get access to the same
  // vue-loader options because we've set an ident in the plugin and used that
  // ident to create the request for this loader in the pitcher.
  const options = loaderUtils.getOptions(loaderContext) || {}

  const cb = loaderContext.async()
  const compile = template => cb(null, actuallyCompile(
    template,
    options,
    loaderContext,
    query
  ))

  if (query.lang && consolidate[query.lang]) {
    preprocess(
      template,
      options,
      loaderContext,
      query.lang,
      (err, template) => {
        if (err) return cb(err)
        compile(template)
      }
    )
  } else {
    compile(template)
  }
}

function preprocess (rawTemplate, options, loaderContext, lang, cb) {
  const engineOptions = Object.assign({
    filename: loaderContext.resourcePath
  }, options.template)

  consolidate[lang].render(rawTemplate, engineOptions, (err, template) => {
    if (err) {
      return cb(err)
    }
    cb(null, template)
  })
}

function actuallyCompile (sourceTemplate, options, loaderContext, query) {
  const { id } = query
  const isServer = loaderContext.target === 'node'
  const isProduction = loaderContext.minimize || process.env.NODE_ENV === 'production'
  const needsHotReload = !isServer && !isProduction && options.hotReload !== false
  const defaultModules = [transformAssetUrl(options.transformAssetUrl), transformSrcset()]
  const hasComment = query.comment != null
  const hasFunctionalTemplate = query.functional != null

  const {
    preserveWhitespace,
    modules,
    directives
  } = options.compilerOptions || {}

  const compilerOptions = {
    scopeId: query.scoped != null ? `data-v-${id}` : null,
    preserveWhitespace,
    modules: defaultModules.concat(modules || []),
    directives: directives || {},
    comments: hasComment
  }

  const compile =
    isServer && compiler.ssrCompile && options.optimizeSSR !== false
      ? compiler.ssrCompile
      : compiler.compile

  const compiled = compile(sourceTemplate, compilerOptions)

  // tips
  if (compiled.tips && compiled.tips.length) {
    compiled.tips.forEach(tip => {
      loaderContext.emitWarning(tip)
    })
  }

  let code
  if (compiled.errors && compiled.errors.length) {
    loaderContext.emitError(
      `\n  Error compiling template:\n${pad(sourceTemplate)}\n` +
        compiled.errors.map(e => `  - ${e}`).join('\n') +
        '\n'
    )
    code =
      `export var render = function () {}\n` +
      `export var staticRenderFns = []`
  } else {
    const bubleOptions = options.buble || {
      transforms: {
        stripWithFunctional: hasFunctionalTemplate
      }
    }
    const staticRenderFns = compiled.staticRenderFns.map(fn =>
      toFunction(fn, hasFunctionalTemplate)
    )

    code =
      transpile(
        'var render = ' +
          toFunction(compiled.render, hasFunctionalTemplate) +
          '\n' +
          'var staticRenderFns = [' +
          staticRenderFns.join(',') +
          ']',
        bubleOptions
      ) + '\n'

    // prettify render fn
    if (!isProduction) {
      code = prettier.format(code, { semi: false })
    }

    // mark with stripped (this enables Vue to use correct runtime proxy detection)
    if (!isProduction && bubleOptions.transforms.stripWith !== false) {
      code += `render._withStripped = true\n`
    }
    code += `export { render, staticRenderFns }`
  }

  // hot-reload
  if (needsHotReload) {
    code += genTemplateHotReloadCode(id)
  }

  return code
}

function toFunction (code, hasFunctionalTemplate) {
  return (
    'function (' + (hasFunctionalTemplate ? '_h,_vm' : '') + ') {' + code + '}'
  )
}

function pad (sourceTemplate) {
  return sourceTemplate
    .split(/\r?\n/)
    .map(line => `  ${line}`)
    .join('\n')
}