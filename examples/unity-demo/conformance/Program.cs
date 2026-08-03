using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using TheLoom;

namespace TheLoom.Conformance
{
    /// <summary>
    /// 脚本语义对拍(R20-4):跑 examples/godot-demo/script_fixture.json,
    /// 与 TS 侧 scriptConformance.test.ts、Godot 侧 script_conformance_test.gd
    /// 同一份夹具逐条比对。任一条不一致以非零退出码结束。
    ///
    ///   dotnet run --project examples/unity-demo/conformance
    /// </summary>
    public static class Program
    {
        static readonly List<string> Failures = new List<string>();
        static int checkedCount;

        public static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--demo") return Demo.Run(args);
            string path = args.Length > 0
                ? args[0]
                : Path.Combine(AppContext.BaseDirectory, "../../../../../godot-demo/script_fixture.json");
            if (!File.Exists(path))
            {
                Console.Error.WriteLine("✗ 读不到夹具:" + Path.GetFullPath(path));
                return 1;
            }

            var fixture = TheLoomJson.Parse(File.ReadAllText(path)) as Dictionary<string, object>;
            if (fixture == null) { Console.Error.WriteLine("✗ 夹具不是 JSON 对象"); return 1; }

            RunConditions(fixture);
            RunNumbers(fixture);
            RunInstructions(fixture);

            Console.WriteLine();
            if (checkedCount == 0)
            {
                Console.Error.WriteLine("✗ 没有跑到任何用例(夹具为空)");
                return 1;
            }
            if (Failures.Count == 0)
            {
                Console.WriteLine($"✓ 脚本语义对拍通过:{checkedCount} 条用例与 TypeScript 一致");
                return 0;
            }
            Console.Error.WriteLine($"✗ {Failures.Count}/{checkedCount} 条与 TypeScript 不一致:");
            foreach (string f in Failures) Console.Error.WriteLine("    " + f);
            return 1;
        }

        static TheLoomScript.Env MakeEnv(Dictionary<string, object> fixture)
        {
            var env = new TheLoomScript.Env();
            if (fixture.GetValueOrDefault("vars") is Dictionary<string, object> vars)
                foreach (var kv in vars) env.Vars[kv.Key] = kv.Value;
            if (fixture.GetValueOrDefault("entityProps") is Dictionary<string, object> props)
                foreach (var kv in props)
                    if (kv.Value is Dictionary<string, object> fields)
                        env.EntityProps[kv.Key] = new Dictionary<string, object>(fields);
            var seen = new HashSet<string>(
                (fixture.GetValueOrDefault("seenTech") as List<object> ?? new List<object>()).OfType<string>());
            env.Seen = tech => seen.Contains(tech);
            return env;
        }

        static bool Same(object a, object b)
        {
            if (a is bool ba && b is bool bb) return ba == bb;
            if (a == null || b == null) return a == null && b == null;
            if (a is string sa && b is string sb) return sa == sb;
            double na = TheLoomScript.ToNum(a);
            double nb = TheLoomScript.ToNum(b);
            if (double.IsNaN(na) || double.IsNaN(nb)) return Equals(a, b);
            return Math.Abs(na - nb) < 0.000001;
        }

        static string Show(object v) => v == null ? "null" : TheLoomScript.AsText(v);

        static void RunConditions(Dictionary<string, object> fixture)
        {
            foreach (var c in (fixture.GetValueOrDefault("conditions") as List<object> ?? new List<object>())
                     .Cast<Dictionary<string, object>>())
            {
                var env = MakeEnv(fixture);
                string src = c.GetValueOrDefault("src") as string ?? "";
                object want = c.GetValueOrDefault("expect");
                bool? got = TheLoomScript.EvalCondition(src, env);
                checkedCount++;
                object gotValue = got.HasValue ? (object)got.Value : null;
                if (!Same(gotValue, want))
                    Failures.Add($"条件 `{src}` → {Show(gotValue)},期望 {Show(want)}");
            }
        }

        static void RunNumbers(Dictionary<string, object> fixture)
        {
            foreach (var c in (fixture.GetValueOrDefault("numbers") as List<object> ?? new List<object>())
                     .Cast<Dictionary<string, object>>())
            {
                var env = MakeEnv(fixture);
                string src = c.GetValueOrDefault("src") as string ?? "";
                object want = c.GetValueOrDefault("expect");
                double got = TheLoomScript.EvalNumber(src, env);
                checkedCount++;
                if (!Same(got, want))
                    Failures.Add($"数值 `{src}` → {Show(got)},期望 {Show(want)}");
            }
        }

        static void RunInstructions(Dictionary<string, object> fixture)
        {
            foreach (var c in (fixture.GetValueOrDefault("instructions") as List<object> ?? new List<object>())
                     .Cast<Dictionary<string, object>>())
            {
                var env = MakeEnv(fixture);
                string src = c.GetValueOrDefault("src") as string ?? "";
                TheLoomScript.ApplyInstructions(src, env);
                if (c.GetValueOrDefault("vars") is Dictionary<string, object> wantVars)
                    foreach (var kv in wantVars)
                    {
                        checkedCount++;
                        object got = env.Vars.GetValueOrDefault(kv.Key);
                        if (!Same(got, kv.Value))
                            Failures.Add($"指令 `{src}` 后 {kv.Key} = {Show(got)},期望 {Show(kv.Value)}");
                    }
                if (c.GetValueOrDefault("entityProps") is Dictionary<string, object> wantProps)
                    foreach (var tech in wantProps)
                        if (tech.Value is Dictionary<string, object> fields)
                            foreach (var kv in fields)
                            {
                                checkedCount++;
                                object got = env.EntityProps.GetValueOrDefault(tech.Key)?.GetValueOrDefault(kv.Key);
                                if (!Same(got, kv.Value))
                                    Failures.Add($"指令 `{src}` 后 {tech.Key}.{kv.Key} = {Show(got)},期望 {Show(kv.Value)}");
                            }
            }
        }
    }
}
