(function() {
  "use strict";

  var SandBox = window.SandBox = function(options) {
    var frame = this.frame = document.createElement("iframe");
    frame.id = "sandbox";
    frame.style.display = "none";
    frame.src = "about:blank";
    document.body.appendChild(frame);

    var win = this.win = frame.contentWindow;
    var self = win.__sandbox = this;

    win.onerror = function(e, _file, line) {
      if (!self.output) return;
      self.output.out("error", [e + (line != null ? " (line " + line + ")" : "")]);
      return true;
    };
    win.console = {
      log: function() { self.out("log", arguments); },
      error: function() { self.out("error", arguments); },
      warn: function() { self.out("warn", arguments); },
      info: function() { self.out("log", arguments); }
    };
    win.__setTimeout = win.setTimeout;
    win.__setInterval = win.setInterval;
    win.setTimeout = function(code, time) {
      return win.__setTimeout(function() { self.run(code); }, time);
    };
    win.setInterval = function(code, time) {
      return win.__setInterval(function() { self.run(code); }, time);
    };

    this.startedAt = 0;
    this.extraSecs = 1;
    this.output = null;

    if (options.loadFiles) setTimeout(function() {
      var i = 0;
      function loadNext() {
        if (i == options.loadFiles.length) return;
        var script = win.document.createElement("script");
        script.src = options.loadFiles[i];
        win.document.body.appendChild(script);
        ++i;
        script.addEventListener("load", loadNext);
      }
      loadNext();
    }, 50);
  };

  SandBox.prototype = {
    run: function(code, output) {
      if (output) this.output = output;
      this.startedAt = Date.now();
      this.extraSecs = 1;
      this.win.__c = 0;
      this.win.__setTimeout(preprocess(code, this), 0);
    },
    tick: function() {
      var now = Date.now();
      if (now < this.startedAt + this.extraSecs * 1000) return;
      var bail = confirm("This code has been running for " + this.extraSecs +
                         " seconds. Abort it?");
      this.startedAt += Date.now() - now;
      this.extraSecs += Math.max(this.extraSecs, 8);
      if (bail) throw new Error("Aborted");
    },
    out: function(type, args) {
      if (this.output) this.output.out(type, args);
      else console[type].apply(console, args);
    },
    error: function(exception) {
      if (!this.output) throw exception;
      var pos = /(?:\bat |@).*?([^\/:]+):(\d+)/.exec(exception.stack);
      if (pos && pos[1].match(/sandbox/)) pos = null;
      this.output.out("error", [String(exception) + (pos ? " (line " + pos[2] + ")" : "")]);
    }
  };

  function preprocess(code, sandbox) {
    if (typeof code != "string") {
      if (code.apply)
        return function() {
          try { return code.apply(this, arguments); }
          catch(e) { sandbox.error(e); }
        };
      return code;
    }

    try { var ast = acorn.parse(code); }
    catch(e) { return code; }
    var patches = [];
    var backJump = "if (++__c % 1000 === 0) __sandbox.tick();";
    function loop(node) {
      if (node.body.type == "BlockStatement") {
        patches.push({from: node.body.end - 1, text: backJump});
      } else {
        patches.push({from: node.body.start, text: "{"},
                     {from: node.body.end, text: backJump + "}"});
      }
    }
    acorn.walk.simple(ast, {
      ForStatement: loop,
      ForInStatement: loop,
      WhileStatement: loop,
      DoWhileStatement: loop
    });
    patches.sort(function(a, b) { return a.from - b.from; });
    var out = "";
    for (var i = 0, pos = 0; i < patches.length; ++i) {
      var patch = patches[i];
      out += code.slice(pos, patch.from) + patch.text;
      pos = patch.to || patch.from;
    }
    out += code.slice(pos, code.length);
    return "try{" + out + "\n}catch(e){__sandbox.error(e);}";
  }

  var Output = SandBox.Output = function(div) {
    this.div = div;
  };

  Output.prototype = {
    clear: function() { this.div.innerHTML = ""; },
    out: function(type, args) {
      var wrap = document.createElement("pre");
      wrap.className = "sandbox-output-" + type;
      for (var i = 0; i < args.length; ++i) {
        var arg = args[i];
        if (i) wrap.appendChild(document.createTextNode(" "));
        if (typeof arg == "string")
          wrap.appendChild(document.createTextNode(arg));
        else
          wrap.appendChild(represent(arg, 58));
      }
      this.div.appendChild(wrap);
    }
  };

  function span(type, text) {
    var sp = document.createElement("span");
    sp.className = "sandbox-output-" + type;
    sp.appendChild(document.createTextNode(text));
    return sp;
  }

  function eltSize(elt) {
    return elt.textContent.length;
  }

  function represent(val, space) {
    if (typeof val == "boolean") return span("bool", String(val));
    if (typeof val == "number") return span("number", String(val));
    if (typeof val == "string") return span("string", JSON.stringify(val));
    if (val == null) return span("null", String(val));
    if (Array.isArray(val)) return representArray(val, space);
    else return representObj(val, space);
  }

  function representArray(val, space) {
    space -= 2;
    var wrap = document.createElement("span");
    wrap.appendChild(document.createTextNode("["));
    for (var i = 0; i < val.length; ++i) {
      if (i) {
        wrap.appendChild(document.createTextNode(", "));
        space -= 2;
      }
      var next = space > 0 && represent(val[i], space);
      var nextSize = next ? eltSize(next) : 0;
      if (space - nextSize <= 0) {
        wrap.appendChild(span("etc", "…")).addEventListener("click", function(e) {
          expandObj(wrap, "array", val);
        });
        break;
      }
      space -= nextSize;
      wrap.appendChild(next);
    }
    wrap.appendChild(document.createTextNode("]"));
    return wrap;
  }

  function representObj(val, space) {
    var string = val.toString(), m, elt;
    if (/^\[object .*\]$/.test(string))
      return representSimpleObj(val, space);
    if (val.call && (m = string.match(/^\s*(function[^(]*\([^)]*\))/)))
      return span("fun", m[1] + "{…}");
    var elt = span("etc", string);
    elt.addEventListener("click", function(e) {
      expandObj(elt, "obj", val);
    });
    return elt;
  }

  function constructorName(obj) {
    if (!obj.constructor) return null;
    var m = String(obj.constructor).match(/^function\s*([^\s(]+)/);
    if (m && m[1] != "Object") return m[1];
  }

  function hop(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }

  function representSimpleObj(val, space) {
    space -= 2;
    var wrap = document.createElement("span");
    var name = constructorName(val);
    if (name) {
      space -= name.length;
      wrap.appendChild(document.createTextNode(name));
    }
    wrap.appendChild(document.createTextNode("{"));
    try {
      var first = true;
      for (var prop in val) if (hop(val, prop)) {
        if (first) {
          first = false;
        } else {
          space -= 2;
          wrap.appendChild(document.createTextNode(", "));
        }
        var next = space > 0 && represent(val[prop], space);
        var nextSize = next ? prop.length + 2 + eltSize(next) : 0;
        if (space - nextSize <= 0) {
          wrap.appendChild(span("etc", "…")).addEventListener("click", function(e) {
            expandObj(wrap, "obj", val);
          });
          break;
        }
        space -= nextSize;
        wrap.appendChild(span("prop", prop + ": "));
        wrap.appendChild(next);
      }
    } catch (e) {
      wrap.appendChild(document.createTextNode("…"));
    }
    wrap.appendChild(document.createTextNode("}"));
    return wrap;
  }

  function expandObj(node, type, val) {
    var wrap = document.createElement("span");
    wrap.appendChild(document.createTextNode(type == "array" ? "[" : "{"));
    var block = wrap.appendChild(document.createElement("div"));
    block.className = "sandbox-output-etc-block";
    var table = block.appendChild(document.createElement("table"));
    function addProp(name) {
      var row = table.appendChild(document.createElement("tr"));
      row.appendChild(document.createElement("td")).appendChild(span("prop", name + ":"));
      row.appendChild(document.createElement("td")).appendChild(represent(val[name], 40));
    }
    if (type == "array") {
      for (var i = 0; i < val.length; ++i) addProp(i);
    } else {
      for (var prop in val) if (hop(val, prop)) addProp(prop);
    }
    wrap.appendChild(document.createTextNode(type == "array" ? "]" : "}"));
    node.parentNode.replaceChild(wrap, node);
  }
})();
