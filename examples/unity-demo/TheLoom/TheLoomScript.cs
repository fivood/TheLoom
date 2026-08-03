using System;
using System.Collections.Generic;
using System.Globalization;

namespace TheLoom
{
    /// <summary>
    /// TheLoom 脚本求值器(C#)。
    ///
    /// 语义与 TS 端 src/script/ 逐条对齐,由 examples/godot-demo/script_fixture.json
    /// 三端共用对拍:条件走向、数值结果、指令终值都不能因为换了运行库而变化。
    ///
    /// 支持:字面量、变量、实体.字段、seen()/unseen()、! -、* / %、+ -、
    ///       比较(== != === !== &lt; &lt;= &gt; &gt;=)、&amp;&amp; ||(返回操作数)、三元 ?:
    /// </summary>
    public static class TheLoomScript
    {
        public sealed class Env
        {
            public Dictionary<string, object> Vars = new Dictionary<string, object>();
            public Dictionary<string, Dictionary<string, object>> EntityProps
                = new Dictionary<string, Dictionary<string, object>>();
            public Func<string, bool> Seen = _ => false;
        }

        /* ---------- 对外入口 ---------- */

        /// <summary>条件求值;无法求值返回 null(调用方保留全部分支)</summary>
        public static bool? EvalCondition(string src, Env env)
        {
            if (string.IsNullOrWhiteSpace(src)) return null;
            try
            {
                var parser = new Parser(Tokenize(src), env);
                object value = parser.ParseExpression();
                if (parser.Failed || !parser.AtEnd) return null;
                return Truthy(value);
            }
            catch { return null; }
        }

        /// <summary>数值表达式求值;失败返回 0。**不取整** —— 与 TS 的 evalNumber 一致</summary>
        public static double EvalNumber(string src, Env env)
        {
            if (string.IsNullOrWhiteSpace(src)) return 0;
            try
            {
                var parser = new Parser(Tokenize(src), env);
                object value = parser.ParseExpression();
                if (parser.Failed) return 0;
                double n = ToNum(value);
                return double.IsNaN(n) || double.IsInfinity(n) ? 0 : n;
            }
            catch { return 0; }
        }

        /// <summary>执行分号分隔的赋值指令;返回警告列表</summary>
        public static List<string> ApplyInstructions(string src, Env env)
        {
            var warnings = new List<string>();
            if (string.IsNullOrWhiteSpace(src)) return warnings;
            foreach (string raw in src.Split(';'))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                string op = null;
                int at = -1;
                foreach (string candidate in new[] { "+=", "-=", "*=", "/=", "=" })
                {
                    int idx = line.IndexOf(candidate, StringComparison.Ordinal);
                    // "=" 要排除 == 与 >= 这类比较运算符
                    if (idx > 0 && candidate == "=" && idx + 1 < line.Length && line[idx + 1] == '=') continue;
                    if (idx > 0 && candidate == "=" && "!<>=".IndexOf(line[idx - 1]) >= 0) continue;
                    if (idx > 0) { op = candidate; at = idx; break; }
                }
                if (op == null) { warnings.Add("无法识别指令:" + line); continue; }

                string lhs = line.Substring(0, at).Trim();
                string rhs = line.Substring(at + op.Length).Trim();
                object value;
                try
                {
                    var parser = new Parser(Tokenize(rhs), env);
                    value = parser.ParseExpression();
                    if (parser.Failed) { warnings.Add("无法求值:" + line); continue; }
                }
                catch { warnings.Add("无法求值:" + line); continue; }
                Assign(env, lhs, op, value, warnings);
            }
            return warnings;
        }

        static void Assign(Env env, string lhs, string op, object value, List<string> warnings)
        {
            int dot = lhs.IndexOf('.');
            if (dot > 0)
            {
                string tech = lhs.Substring(0, dot).Trim();
                string field = lhs.Substring(dot + 1).Trim();
                if (!env.EntityProps.TryGetValue(tech, out var props))
                {
                    props = new Dictionary<string, object>();
                    env.EntityProps[tech] = props;
                }
                props.TryGetValue(field, out object current);
                props[field] = Combine(current ?? 0d, op, value);
                return;
            }
            if (!env.Vars.ContainsKey(lhs))
            {
                warnings.Add("未声明变量:" + lhs);
                env.Vars[lhs] = 0d;
            }
            env.Vars[lhs] = Combine(env.Vars[lhs], op, value);
        }

        static object Combine(object current, string op, object value)
        {
            switch (op)
            {
                case "=": return value;
                case "+=":
                    if (current is string || value is string) return AsText(current) + AsText(value);
                    return ToNum(current) + ToNum(value);
                case "-=": return ToNum(current) - ToNum(value);
                case "*=": return ToNum(current) * ToNum(value);
                case "/=":
                {
                    double d = ToNum(value);
                    return d == 0 ? 0d : ToNum(current) / d;
                }
            }
            return value;
        }

        /* ---------- 值语义(与 TS 对齐) ---------- */

        public static bool Truthy(object v)
        {
            switch (v)
            {
                case null: return false;
                case bool b: return b;
                case double d: return d != 0;
                case string s: return s.Length > 0;
                default: return true;
            }
        }

        public static double ToNum(object v)
        {
            switch (v)
            {
                case null: return 0;
                case bool b: return b ? 1 : 0;
                case double d: return d;
                case string s:
                    if (s.Trim().Length == 0) return 0;
                    return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out double parsed)
                        ? parsed : double.NaN;
                default: return double.NaN;
            }
        }

        /// <summary>文本化:整数值不带小数点,与 JS 的字符串拼接形态一致</summary>
        public static string AsText(object v)
        {
            if (v is double d) return TheLoomJson.NumberToString(d);
            if (v is bool b) return b ? "true" : "false";
            return v?.ToString() ?? "";
        }

        /// <summary>TS 的 typeof 只分 boolean / number / string</summary>
        static bool SameKind(object a, object b)
        {
            if (a is double || b is double) return a is double && b is double;
            if (a is bool || b is bool) return a is bool && b is bool;
            return a is string && b is string;
        }

        static bool StrictEq(object a, object b)
        {
            if (!SameKind(a, b)) return false;
            if (a is double x && b is double y) return x == y;
            return Equals(a, b);
        }

        /// <summary>宽松相等:同类型直接比,异类型转数值比(对齐 TS looseEq)</summary>
        static bool LooseEq(object a, object b)
        {
            if (SameKind(a, b)) return StrictEq(a, b);
            return ToNum(a) == ToNum(b);
        }

        /* ---------- 词法 ---------- */

        struct Token
        {
            public string Kind;   // num / str / bool / ident / op / null
            public object Value;
        }

        static bool IsIdentStart(char c) => c == '_' || char.IsLetter(c) || c > 127;

        static List<Token> Tokenize(string src)
        {
            var tokens = new List<Token>();
            int i = 0;
            while (i < src.Length)
            {
                char c = src[i];
                if (char.IsWhiteSpace(c)) { i++; continue; }
                if (c == '"' || c == '\'')
                {
                    char quote = c;
                    i++;
                    var sb = new System.Text.StringBuilder();
                    while (i < src.Length && src[i] != quote)
                    {
                        if (src[i] == '\\' && i + 1 < src.Length) { sb.Append(src[i + 1]); i += 2; }
                        else { sb.Append(src[i]); i++; }
                    }
                    i++;
                    tokens.Add(new Token { Kind = "str", Value = sb.ToString() });
                    continue;
                }
                if (char.IsDigit(c))
                {
                    int start = i;
                    while (i < src.Length && (char.IsDigit(src[i]) || src[i] == '.')) i++;
                    tokens.Add(new Token
                    {
                        Kind = "num",
                        Value = double.Parse(src.Substring(start, i - start), CultureInfo.InvariantCulture),
                    });
                    continue;
                }
                if (IsIdentStart(c))
                {
                    int start = i;
                    while (i < src.Length && (IsIdentStart(src[i]) || char.IsDigit(src[i]) || src[i] == '.')) i++;
                    string word = src.Substring(start, i - start);
                    if (word == "true") tokens.Add(new Token { Kind = "bool", Value = true });
                    else if (word == "false") tokens.Add(new Token { Kind = "bool", Value = false });
                    else if (word == "null") tokens.Add(new Token { Kind = "null", Value = null });
                    else tokens.Add(new Token { Kind = "ident", Value = word });
                    continue;
                }
                // 三字符先于双字符,双字符先于单字符:=== 不能被切成 == 加 =
                if (i + 2 < src.Length)
                {
                    string three = src.Substring(i, 3);
                    if (three == "===" || three == "!==")
                    {
                        tokens.Add(new Token { Kind = "op", Value = three });
                        i += 3;
                        continue;
                    }
                }
                if (i + 1 < src.Length)
                {
                    string two = src.Substring(i, 2);
                    if (two == "==" || two == "!=" || two == ">=" || two == "<=" || two == "&&" || two == "||")
                    {
                        tokens.Add(new Token { Kind = "op", Value = two });
                        i += 2;
                        continue;
                    }
                }
                if ("><+-*/%!(),?:".IndexOf(c) >= 0)
                {
                    tokens.Add(new Token { Kind = "op", Value = c.ToString() });
                    i++;
                    continue;
                }
                i++; // 未知字符跳过
            }
            return tokens;
        }

        /* ---------- 递归下降 parser ---------- */

        sealed class Parser
        {
            readonly List<Token> tokens;
            readonly Env env;
            int pos;
            public bool Failed;

            public Parser(List<Token> tokens, Env env)
            {
                this.tokens = tokens;
                this.env = env;
            }

            public bool AtEnd => pos >= tokens.Count;

            Token? Peek() => pos < tokens.Count ? tokens[pos] : (Token?)null;

            bool ConsumeOp(string value)
            {
                var t = Peek();
                if (t == null || t.Value.Kind != "op" || !Equals(t.Value.Value, value)) return false;
                pos++;
                return true;
            }

            object Fail() { Failed = true; return null; }

            public object ParseExpression() => Ternary();

            object Ternary()
            {
                object test = Or();
                if (Failed) return null;
                if (!ConsumeOp("?")) return test;
                object thenValue = Ternary();
                if (Failed) return null;
                if (!ConsumeOp(":")) return Fail();
                object elseValue = Ternary();
                if (Failed) return null;
                return Truthy(test) ? thenValue : elseValue;
            }

            // && 与 || 返回操作数本身,不是布尔(与 TS/JS 一致)
            object Or()
            {
                object left = And();
                while (ConsumeOp("||"))
                {
                    object right = And();
                    if (Failed) return null;
                    left = Truthy(left) ? left : right;
                }
                return left;
            }

            object And()
            {
                object left = Comparison();
                while (ConsumeOp("&&"))
                {
                    object right = Comparison();
                    if (Failed) return null;
                    left = Truthy(left) ? right : left;
                }
                return left;
            }

            object Comparison()
            {
                object left = Additive();
                var t = Peek();
                if (t == null || t.Value.Kind != "op") return left;
                string op = t.Value.Value as string;
                if (op != "==" && op != "!=" && op != "===" && op != "!==" &&
                    op != ">" && op != "<" && op != ">=" && op != "<=") return left;
                pos++;
                object right = Additive();
                if (Failed) return null;
                switch (op)
                {
                    case "==": return LooseEq(left, right);
                    case "!=": return !LooseEq(left, right);
                    case "===": return StrictEq(left, right);
                    case "!==": return !StrictEq(left, right);
                    case ">": return ToNum(left) > ToNum(right);
                    case "<": return ToNum(left) < ToNum(right);
                    case ">=": return ToNum(left) >= ToNum(right);
                    case "<=": return ToNum(left) <= ToNum(right);
                }
                return left;
            }

            object Additive()
            {
                object left = Multiplicative();
                while (true)
                {
                    var t = Peek();
                    if (t == null || t.Value.Kind != "op") break;
                    string op = t.Value.Value as string;
                    if (op != "+" && op != "-") break;
                    pos++;
                    object right = Multiplicative();
                    if (Failed) return null;
                    if (op == "+" && (left is string || right is string)) left = AsText(left) + AsText(right);
                    else if (op == "+") left = ToNum(left) + ToNum(right);
                    else left = ToNum(left) - ToNum(right);
                }
                return left;
            }

            object Multiplicative()
            {
                object left = Unary();
                while (true)
                {
                    var t = Peek();
                    if (t == null || t.Value.Kind != "op") break;
                    string op = t.Value.Value as string;
                    if (op != "*" && op != "/" && op != "%") break;
                    pos++;
                    object right = Unary();
                    if (Failed) return null;
                    if (op == "*") left = ToNum(left) * ToNum(right);
                    else if (op == "/")
                    {
                        double d = ToNum(right);
                        left = d == 0 ? 0d : ToNum(left) / d;   // 除零回 0,不产生 Infinity
                    }
                    else
                    {
                        double m = ToNum(right);
                        left = m == 0 ? 0d : ToNum(left) % m;
                    }
                }
                return left;
            }

            object Unary()
            {
                if (ConsumeOp("!"))
                {
                    object v = Unary();
                    if (Failed) return null;
                    return !Truthy(v);
                }
                if (ConsumeOp("-"))
                {
                    object v = Unary();
                    if (Failed) return null;
                    return -ToNum(v);
                }
                return Primary();
            }

            object Primary()
            {
                var t = Peek();
                if (t == null) return Fail();
                string kind = t.Value.Kind;
                if (kind == "num" || kind == "str" || kind == "bool") { pos++; return t.Value.Value; }
                if (kind == "null") { pos++; return null; }
                if (ConsumeOp("("))
                {
                    object v = ParseExpression();
                    if (!ConsumeOp(")")) return Fail();
                    return v;
                }
                if (kind == "ident")
                {
                    pos++;
                    string name = (string)t.Value.Value;
                    // seen("技术名") / unseen("技术名")
                    if ((name == "seen" || name == "unseen") && ConsumeOp("("))
                    {
                        object arg = null;
                        if (!(Peek() is Token close && close.Kind == "op" && Equals(close.Value, ")")))
                        {
                            arg = ParseExpression();
                            if (Failed) return null;
                        }
                        if (!ConsumeOp(")")) return Fail();
                        bool hit = env.Seen(AsText(arg));
                        return name == "seen" ? hit : !hit;
                    }
                    int dot = name.IndexOf('.');
                    if (dot > 0)
                    {
                        string tech = name.Substring(0, dot);
                        string field = name.Substring(dot + 1);
                        if (env.EntityProps.TryGetValue(tech, out var props) && props.TryGetValue(field, out object value))
                            return value;
                        return null;
                    }
                    return env.Vars.TryGetValue(name, out object varValue) ? varValue : null;
                }
                return Fail();
            }
        }
    }
}
