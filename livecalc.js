(function () {
  "use strict";
  function q(b) {
    var c = 0;
    return function () {
      return c < b.length ? { done: !1, value: b[c++] } : { done: !0 };
    };
  }
  function t(b) {
    var c =
      typeof Symbol != "undefined" && Symbol.iterator && b[Symbol.iterator];
    if (c) return c.call(b);
    if (typeof b.length == "number") return { next: q(b) };
    throw Error(String(b) + " is not an iterable or ArrayLike");
  }
  var u =
    typeof Object.defineProperties == "function"
      ? Object.defineProperty
      : function (b, c, g) {
          if (b == Array.prototype || b == Object.prototype) return b;
          b[c] = g.value;
          return b;
        };
  function v(b) {
    b = [
      "object" == typeof globalThis && globalThis,
      b,
      "object" == typeof window && window,
      "object" == typeof self && self,
      "object" == typeof global && global,
    ];
    for (var c = 0; c < b.length; ++c) {
      var g = b[c];
      if (g && g.Math == Math) return g;
    }
    throw Error("Cannot find global object");
  }
  var w = v(this);
  function x(b, c) {
    if (c)
      a: {
        var g = w;
        b = b.split(".");
        for (var h = 0; h < b.length - 1; h++) {
          var l = b[h];
          if (!(l in g)) break a;
          g = g[l];
        }
        b = b[b.length - 1];
        h = g[b];
        c = c(h);
        c != h &&
          c != null &&
          u(g, b, { configurable: !0, writable: !0, value: c });
      }
  }
  function y() {
    this.j = !1;
    this.g = null;
    this.u = void 0;
    this.h = 1;
    this.v = this.l = 0;
    this.i = null;
  }
  function z(b) {
    if (b.j) throw new TypeError("Generator is already running");
    b.j = !0;
  }
  y.prototype.o = function (b) {
    this.u = b;
  };
  function A(b, c) {
    b.i = { I: c, J: !0 };
    b.h = b.l || b.v;
  }
  y.prototype.return = function (b) {
    this.i = { return: b };
    this.h = this.v;
  };
  function B(b) {
    this.g = new y();
    this.h = b;
  }
  function E(b, c) {
    z(b.g);
    var g = b.g.g;
    if (g)
      return F(
        b,
        "return" in g
          ? g["return"]
          : function (h) {
              return { value: h, done: !0 };
            },
        c,
        b.g.return,
      );
    b.g.return(c);
    return G(b);
  }
  function F(b, c, g, h) {
    try {
      var l = c.call(b.g.g, g);
      if (!(l instanceof Object))
        throw new TypeError("Iterator result " + l + " is not an object");
      if (!l.done) return ((b.g.j = !1), l);
      var m = l.value;
    } catch (f) {
      return ((b.g.g = null), A(b.g, f), G(b));
    }
    b.g.g = null;
    h.call(b.g, m);
    return G(b);
  }
  function G(b) {
    for (; b.g.h; )
      try {
        var c = b.h(b.g);
        if (c) return ((b.g.j = !1), { value: c.value, done: !1 });
      } catch (g) {
        ((b.g.u = void 0), A(b.g, g));
      }
    b.g.j = !1;
    if (b.g.i) {
      c = b.g.i;
      b.g.i = null;
      if (c.J) throw c.I;
      return { value: c.return, done: !0 };
    }
    return { value: void 0, done: !0 };
  }
  function H(b) {
    this.next = function (c) {
      z(b.g);
      b.g.g ? (c = F(b, b.g.g.next, c, b.g.o)) : (b.g.o(c), (c = G(b)));
      return c;
    };
    this.throw = function (c) {
      z(b.g);
      b.g.g ? (c = F(b, b.g.g["throw"], c, b.g.o)) : (A(b.g, c), (c = G(b)));
      return c;
    };
    this.return = function (c) {
      return E(b, c);
    };
    this[Symbol.iterator] = function () {
      return this;
    };
  }
  function I(b) {
    function c(h) {
      return b.next(h);
    }
    function g(h) {
      return b.throw(h);
    }
    return new Promise(function (h, l) {
      function m(f) {
        f.done ? h(f.value) : Promise.resolve(f.value).then(c, g).then(m, l);
      }
      m(b.next());
    });
  }
  x("Symbol", function (b) {
    function c(m) {
      if (this instanceof c) throw new TypeError("Symbol is not a constructor");
      return new g(h + (m || "") + "_" + l++, m);
    }
    function g(m, f) {
      this.g = m;
      u(this, "description", { configurable: !0, writable: !0, value: f });
    }
    if (b) return b;
    g.prototype.toString = function () {
      return this.g;
    };
    var h = "jscomp_symbol_" + ((Math.random() * 1e9) >>> 0) + "_",
      l = 0;
    return c;
  });
  x("Symbol.iterator", function (b) {
    if (b) return b;
    b = Symbol("Symbol.iterator");
    u(Array.prototype, b, {
      configurable: !0,
      writable: !0,
      value: function () {
        return J(q(this));
      },
    });
    return b;
  });
  function J(b) {
    b = { next: b };
    b[Symbol.iterator] = function () {
      return this;
    };
    return b;
  }
  x("Promise", function (b) {
    function c(f) {
      this.h = 0;
      this.i = void 0;
      this.g = [];
      this.u = !1;
      var a = this.j();
      try {
        f(a.resolve, a.reject);
      } catch (d) {
        a.reject(d);
      }
    }
    function g() {
      this.g = null;
    }
    function h(f) {
      return f instanceof c
        ? f
        : new c(function (a) {
            a(f);
          });
    }
    if (b) return b;
    g.prototype.h = function (f) {
      if (this.g == null) {
        this.g = [];
        var a = this;
        this.i(function () {
          a.l();
        });
      }
      this.g.push(f);
    };
    var l = w.setTimeout;
    g.prototype.i = function (f) {
      l(f, 0);
    };
    g.prototype.l = function () {
      for (; this.g && this.g.length; ) {
        var f = this.g;
        this.g = [];
        for (var a = 0; a < f.length; ++a) {
          var d = f[a];
          f[a] = null;
          try {
            d();
          } catch (e) {
            this.j(e);
          }
        }
      }
      this.g = null;
    };
    g.prototype.j = function (f) {
      this.i(function () {
        throw f;
      });
    };
    c.prototype.j = function () {
      function f(e) {
        return function (k) {
          d || ((d = !0), e.call(a, k));
        };
      }
      var a = this,
        d = !1;
      return { resolve: f(this.D), reject: f(this.l) };
    };
    c.prototype.D = function (f) {
      if (f === this)
        this.l(new TypeError("A Promise cannot resolve to itself"));
      else if (f instanceof c) this.G(f);
      else {
        a: switch (typeof f) {
          case "object":
            var a = f != null;
            break a;
          case "function":
            a = !0;
            break a;
          default:
            a = !1;
        }
        a ? this.C(f) : this.o(f);
      }
    };
    c.prototype.C = function (f) {
      var a = void 0;
      try {
        a = f.then;
      } catch (d) {
        this.l(d);
        return;
      }
      typeof a == "function" ? this.H(a, f) : this.o(f);
    };
    c.prototype.l = function (f) {
      this.v(2, f);
    };
    c.prototype.o = function (f) {
      this.v(1, f);
    };
    c.prototype.v = function (f, a) {
      if (this.h != 0)
        throw Error(
          "Cannot settle(" +
            f +
            ", " +
            a +
            "): Promise already settled in state" +
            this.h,
        );
      this.h = f;
      this.i = a;
      this.h === 2 && this.F();
      this.K();
    };
    c.prototype.F = function () {
      var f = this;
      l(function () {
        if (f.B()) {
          var a = w.console;
          typeof a !== "undefined" && a.error(f.i);
        }
      }, 1);
    };
    c.prototype.B = function () {
      if (this.u) return !1;
      var f = w.CustomEvent,
        a = w.Event,
        d = w.dispatchEvent;
      if (typeof d === "undefined") return !0;
      typeof f === "function"
        ? (f = new f("unhandledrejection", { cancelable: !0 }))
        : typeof a === "function"
          ? (f = new a("unhandledrejection", { cancelable: !0 }))
          : ((f = w.document.createEvent("CustomEvent")),
            f.initCustomEvent("unhandledrejection", !1, !0, f));
      f.promise = this;
      f.reason = this.i;
      return d(f);
    };
    c.prototype.K = function () {
      if (this.g != null) {
        for (var f = 0; f < this.g.length; ++f) m.h(this.g[f]);
        this.g = null;
      }
    };
    var m = new g();
    c.prototype.G = function (f) {
      var a = this.j();
      f.A(a.resolve, a.reject);
    };
    c.prototype.H = function (f, a) {
      var d = this.j();
      try {
        f.call(a, d.resolve, d.reject);
      } catch (e) {
        d.reject(e);
      }
    };
    c.prototype.then = function (f, a) {
      function d(n, r) {
        return typeof n == "function"
          ? function (C) {
              try {
                e(n(C));
              } catch (D) {
                k(D);
              }
            }
          : r;
      }
      var e,
        k,
        p = new c(function (n, r) {
          e = n;
          k = r;
        });
      this.A(d(f, e), d(a, k));
      return p;
    };
    c.prototype.catch = function (f) {
      return this.then(void 0, f);
    };
    c.prototype.A = function (f, a) {
      function d() {
        switch (e.h) {
          case 1:
            f(e.i);
            break;
          case 2:
            a(e.i);
            break;
          default:
            throw Error("Unexpected state: " + e.h);
        }
      }
      var e = this;
      this.g == null ? m.h(d) : this.g.push(d);
      this.u = !0;
    };
    c.resolve = h;
    c.reject = function (f) {
      return new c(function (a, d) {
        d(f);
      });
    };
    c.race = function (f) {
      return new c(function (a, d) {
        for (var e = t(f), k = e.next(); !k.done; k = e.next())
          h(k.value).A(a, d);
      });
    };
    c.all = function (f) {
      var a = t(f),
        d = a.next();
      return d.done
        ? h([])
        : new c(function (e, k) {
            function p(C) {
              return function (D) {
                n[C] = D;
                r--;
                r == 0 && e(n);
              };
            }
            var n = [],
              r = 0;
            do
              (n.push(void 0),
                r++,
                h(d.value).A(p(n.length - 1), k),
                (d = a.next()));
            while (!d.done);
          });
    };
    return c;
  });
  function K(b, c) {
    return Object.prototype.hasOwnProperty.call(b, c);
  }
  x("Object.is", function (b) {
    return b
      ? b
      : function (c, g) {
          return c === g ? c !== 0 || 1 / c === 1 / g : c !== c && g !== g;
        };
  });
  x("Array.prototype.includes", function (b) {
    return b
      ? b
      : function (c, g) {
          var h = this;
          h instanceof String && (h = String(h));
          var l = h.length;
          g = g || 0;
          for (g < 0 && (g = Math.max(g + l, 0)); g < l; g++) {
            var m = h[g];
            if (m === c || Object.is(m, c)) return !0;
          }
          return !1;
        };
  });
  x("String.prototype.includes", function (b) {
    return b
      ? b
      : function (c, g) {
          if (this == null)
            throw new TypeError(
              "The 'this' value for String.prototype.includes must not be null or undefined",
            );
          if (c instanceof RegExp)
            throw new TypeError(
              "First argument to String.prototype.includes must not be a regular expression",
            );
          return this.indexOf(c, g || 0) !== -1;
        };
  });
  x("WeakMap", function (b) {
    function c(d) {
      this.g = (a += Math.random() + 1).toString();
      if (d) {
        d = t(d);
        for (var e; !(e = d.next()).done; )
          ((e = e.value), this.set(e[0], e[1]));
      }
    }
    function g() {}
    function h(d) {
      var e = typeof d;
      return (e === "object" && d !== null) || e === "function";
    }
    function l(d) {
      if (!K(d, f)) {
        var e = new g();
        u(d, f, { value: e });
      }
    }
    function m(d) {
      var e = Object[d];
      e &&
        (Object[d] = function (k) {
          if (k instanceof g) return k;
          Object.isExtensible(k) && l(k);
          return e(k);
        });
    }
    if (
      (function () {
        if (!b || !Object.seal) return !1;
        try {
          var d = Object.seal({}),
            e = Object.seal({}),
            k = new b([
              [d, 2],
              [e, 3],
            ]);
          if (k.get(d) != 2 || k.get(e) != 3) return !1;
          k.delete(d);
          k.set(e, 4);
          return !k.has(d) && k.get(e) == 4;
        } catch (p) {
          return !1;
        }
      })()
    )
      return b;
    var f = "$jscomp_hidden_" + Math.random();
    m("freeze");
    m("preventExtensions");
    m("seal");
    var a = 0;
    c.prototype.set = function (d, e) {
      if (!h(d)) throw Error("Invalid WeakMap key");
      l(d);
      if (!K(d, f)) throw Error("WeakMap key fail: " + d);
      d[f][this.g] = e;
      return this;
    };
    c.prototype.get = function (d) {
      return h(d) && K(d, f) ? d[f][this.g] : void 0;
    };
    c.prototype.has = function (d) {
      return h(d) && K(d, f) && K(d[f], this.g);
    };
    c.prototype.delete = function (d) {
      return h(d) && K(d, f) && K(d[f], this.g) ? delete d[f][this.g] : !1;
    };
    return c;
  });
  x("Map", function (b) {
    function c() {
      var a = {};
      return (a.m = a.next = a.head = a);
    }
    function g(a, d) {
      var e = a[1];
      return J(function () {
        if (e) {
          for (; e.head != a[1]; ) e = e.m;
          for (; e.next != e.head; )
            return ((e = e.next), { done: !1, value: d(e) });
          e = null;
        }
        return { done: !0, value: void 0 };
      });
    }
    function h(a, d) {
      var e = d && typeof d;
      e == "object" || e == "function"
        ? m.has(d)
          ? (e = m.get(d))
          : ((e = "" + ++f), m.set(d, e))
        : (e = "p_" + d);
      var k = a[0][e];
      if (k && K(a[0], e))
        for (a = 0; a < k.length; a++) {
          var p = k[a];
          if ((d !== d && p.key !== p.key) || d === p.key)
            return { id: e, list: k, index: a, entry: p };
        }
      return { id: e, list: k, index: -1, entry: void 0 };
    }
    function l(a) {
      this[0] = {};
      this[1] = c();
      this.size = 0;
      if (a) {
        a = t(a);
        for (var d; !(d = a.next()).done; )
          ((d = d.value), this.set(d[0], d[1]));
      }
    }
    if (
      (function () {
        if (
          !b ||
          typeof b != "function" ||
          !b.prototype.entries ||
          typeof Object.seal != "function"
        )
          return !1;
        try {
          var a = Object.seal({ x: 4 }),
            d = new b(t([[a, "s"]]));
          if (
            d.get(a) != "s" ||
            d.size != 1 ||
            d.get({ x: 4 }) ||
            d.set({ x: 4 }, "t") != d ||
            d.size != 2
          )
            return !1;
          var e = d.entries(),
            k = e.next();
          if (k.done || k.value[0] != a || k.value[1] != "s") return !1;
          k = e.next();
          return k.done ||
            k.value[0].x != 4 ||
            k.value[1] != "t" ||
            !e.next().done
            ? !1
            : !0;
        } catch (p) {
          return !1;
        }
      })()
    )
      return b;
    var m = new WeakMap();
    l.prototype.set = function (a, d) {
      a = a === 0 ? 0 : a;
      var e = h(this, a);
      e.list || (e.list = this[0][e.id] = []);
      e.entry
        ? (e.entry.value = d)
        : ((e.entry = {
            next: this[1],
            m: this[1].m,
            head: this[1],
            key: a,
            value: d,
          }),
          e.list.push(e.entry),
          (this[1].m.next = e.entry),
          (this[1].m = e.entry),
          this.size++);
      return this;
    };
    l.prototype.delete = function (a) {
      a = h(this, a);
      return a.entry && a.list
        ? (a.list.splice(a.index, 1),
          a.list.length || delete this[0][a.id],
          (a.entry.m.next = a.entry.next),
          (a.entry.next.m = a.entry.m),
          (a.entry.head = null),
          this.size--,
          !0)
        : !1;
    };
    l.prototype.clear = function () {
      this[0] = {};
      this[1] = this[1].m = c();
      this.size = 0;
    };
    l.prototype.has = function (a) {
      return !!h(this, a).entry;
    };
    l.prototype.get = function (a) {
      return (a = h(this, a).entry) && a.value;
    };
    l.prototype.entries = function () {
      return g(this, function (a) {
        return [a.key, a.value];
      });
    };
    l.prototype.keys = function () {
      return g(this, function (a) {
        return a.key;
      });
    };
    l.prototype.values = function () {
      return g(this, function (a) {
        return a.value;
      });
    };
    l.prototype.forEach = function (a, d) {
      for (var e = this.entries(), k; !(k = e.next()).done; )
        ((k = k.value), a.call(d, k[1], k[0], this));
    };
    l.prototype[Symbol.iterator] = l.prototype.entries;
    var f = 0;
    return l;
  });
  x("Set", function (b) {
    function c(g) {
      this.g = new Map();
      if (g) {
        g = t(g);
        for (var h; !(h = g.next()).done; ) this.add(h.value);
      }
      this.size = this.g.size;
    }
    if (
      (function () {
        if (
          !b ||
          typeof b != "function" ||
          !b.prototype.entries ||
          typeof Object.seal != "function"
        )
          return !1;
        try {
          var g = Object.seal({ x: 4 }),
            h = new b(t([g]));
          if (
            !h.has(g) ||
            h.size != 1 ||
            h.add(g) != h ||
            h.size != 1 ||
            h.add({ x: 4 }) != h ||
            h.size != 2
          )
            return !1;
          var l = h.entries(),
            m = l.next();
          if (m.done || m.value[0] != g || m.value[1] != g) return !1;
          m = l.next();
          return m.done ||
            m.value[0] == g ||
            m.value[0].x != 4 ||
            m.value[1] != m.value[0]
            ? !1
            : l.next().done;
        } catch (f) {
          return !1;
        }
      })()
    )
      return b;
    c.prototype.add = function (g) {
      g = g === 0 ? 0 : g;
      this.g.set(g, g);
      this.size = this.g.size;
      return this;
    };
    c.prototype.delete = function (g) {
      g = this.g.delete(g);
      this.size = this.g.size;
      return g;
    };
    c.prototype.clear = function () {
      this.g.clear();
      this.size = 0;
    };
    c.prototype.has = function (g) {
      return this.g.has(g);
    };
    c.prototype.entries = function () {
      return this.g.entries();
    };
    c.prototype.values = function () {
      return this.g.values();
    };
    c.prototype.keys = c.prototype.values;
    c.prototype[Symbol.iterator] = c.prototype.values;
    c.prototype.forEach = function (g, h) {
      var l = this;
      this.g.forEach(function (m) {
        return g.call(h, m, m, l);
      });
    };
    return c;
  });
  (function () {
    function b() {
      return m
        ? Promise.resolve(m)
        : f
          ? f
          : (f = fetch(
              "https://www.gstatic.com/bard-maui/resources/material-design-icon-names.804824289.json",
            )
              .then(function (a) {
                if (!a.ok)
                  throw Error(
                    "HTTP error! status: " +
                      a.status +
                      " fetching https://www.gstatic.com/bard-maui/resources/material-design-icon-names.804824289.json",
                  );
                return a.json();
              })
              .then(function (a) {
                if (!Array.isArray(a))
                  throw new TypeError(
                    "Fetched icon names from https://www.gstatic.com/bard-maui/resources/material-design-icon-names.804824289.json is not an array.",
                  );
                return (m = a);
              })
              .catch(function (a) {
                console.error(
                  "IconChecker: Failed to load valid icon names from https://www.gstatic.com/bard-maui/resources/material-design-icon-names.804824289.json.",
                  a,
                );
                f = null;
                throw a;
              }));
    }
    function c(a) {
      var d, e, k, p;
      return I(
        new H(
          new B(function (n) {
            switch (n.h) {
              case 1:
                d = (a.textContent || "").trim();
                if (
                  !d ||
                  (a.classList.contains("js-replaced-missing-icon") &&
                    d === "radio_button_unchecked")
                )
                  return n.return();
                e = window.getComputedStyle(a);
                if (e.display === "none" || e.visibility === "hidden")
                  return n.return();
                n.l = 2;
                var r = b();
                n.h = 4;
                return { value: r };
              case 4:
                k = n.u;
                n.h = 3;
                n.l = 0;
                break;
              case 2:
                return (
                  (n.l = 0),
                  (n.i = null),
                  console.warn(
                    'IconChecker: Skipping check for icon "' +
                      d +
                      '" as valid names could not be loaded.',
                  ),
                  n.return()
                );
              case 3:
                ((p = k.includes(d))
                  ? a.classList.contains("js-replaced-missing-icon") &&
                    a.classList.remove("js-replaced-missing-icon")
                  : (d === "radio_button_unchecked" &&
                      a.classList.contains("js-replaced-missing-icon")) ||
                    ((a.textContent = "radio_button_unchecked"),
                    a.classList.add("js-replaced-missing-icon")),
                  (n.h = 0));
            }
          }),
        ),
      );
    }
    function g(a) {
      a = a === void 0 ? document.body : a;
      a.querySelectorAll(l).forEach(function (d) {
        c(d);
      });
    }
    function h() {
      b().catch(function () {});
      document.fonts.ready
        .then(function () {
          requestAnimationFrame(function () {
            g(document.body);
            new MutationObserver(function (a) {
              var d = new Set();
              a = t(a);
              for (var e = a.next(); !e.done; e = a.next())
                if (((e = e.value), e.type === "childList"))
                  e.addedNodes.forEach(function (p) {
                    p.nodeType === Node.ELEMENT_NODE &&
                      (p.matches(l) && d.add(p),
                      p.querySelectorAll(l).forEach(function (n) {
                        d.add(n);
                      }));
                  });
                else if (
                  e.type === "attributes" &&
                  e.attributeName === "class"
                ) {
                  var k = e.target;
                  e.target.nodeType === Node.ELEMENT_NODE &&
                    k.matches(l) &&
                    d.add(k);
                } else
                  e.type === "characterData" &&
                    e.target.parentNode &&
                    ((e = e.target.parentNode),
                    e.nodeType === Node.ELEMENT_NODE &&
                      e.matches(l) &&
                      d.add(e));
              d.size > 0 &&
                setTimeout(function () {
                  d.forEach(function (p) {
                    c(p);
                  });
                }, 500);
            }).observe(document.body, {
              childList: !0,
              subtree: !0,
              attributes: !0,
              attributeFilter: ["class"],
              characterData: !0,
            });
          });
        })
        .catch(function (a) {
          console.error(
            "IconChecker: Font loading error. Scanning icons anyway.",
            a,
          );
          requestAnimationFrame(function () {
            g(document.body);
          });
        });
    }
    var l = [
        "material-icons",
        "material-symbols-outlined",
        "material-symbols-rounded",
        "material-symbols-sharp",
      ]
        .map(function (a) {
          return "." + a;
        })
        .join(","),
      m = null,
      f = null;
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", function () {
          h();
        })
      : h();
  })();
}).call(this);
