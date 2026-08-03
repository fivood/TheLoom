using System;
using System.Collections.Generic;
using System.IO;
using TheLoom;

namespace TheLoom.Conformance
{
    /// <summary>
    /// 用真实引擎包跑一遍最小演出,验证 Unity 运行库的五件事:
    /// 数据加载、流程运行、选项、存读档、外部事件回调。
    ///
    ///   dotnet run --project examples/unity-demo/conformance -- --demo &lt;theloom-package.json&gt; [流程] [种子]
    /// </summary>
    public static class Demo
    {
        public static int Run(string[] args)
        {
            string path = args.Length > 1 ? args[1] : null;
            if (path == null || !File.Exists(path))
            {
                Console.Error.WriteLine("用法:--demo <theloom-package.json> [流程技术名] [种子]");
                return 2;
            }
            var pkg = TheLoomJson.Parse(File.ReadAllText(path)) as Dictionary<string, object>;
            var flows = pkg["flows"] as List<object>;
            string flowRef = args.Length > 2 ? args[2] : null;
            if (flowRef == null)
            {
                var first = flows[0] as Dictionary<string, object>;
                flowRef = first.TryGetValue("technicalName", out object tn) && tn is string s && s.Length > 0
                    ? s : first["id"] as string;
            }
            uint seed = args.Length > 3 ? uint.Parse(args[3]) : 42;

            var run = new TheLoomRuntime(pkg, flowRef) { Seed = seed };
            run.OnBeat = b =>
            {
                string head = b.Kind == "dialogue"
                    ? $"【{b.SpeakerName ?? (b.Title.Length > 0 ? b.Title : "旁白")}】"
                    : $"〔{b.Kind}〕{(b.Title.Length > 0 ? " " + b.Title : "")}";
                Console.WriteLine($"    {head} {b.Text}{(b.Note != null ? "  // " + b.Note : "")}".TrimEnd());
            };
            run.OnExternalEvent = call =>
            {
                Console.WriteLine($"    ▷ 外部事件 {call.Name}(wait={call.Wait})→ 宿主处理");
                // 宿主可以在回调里同步解决;运行库有重入保护
                if (call.Wait == "ack") run.ResolveExternal();
                else if (call.Wait == "value") run.ResolveExternal(1d);
            };

            Console.WriteLine($"=== Unity 运行库演出 · {flowRef}(种子 {seed})===");
            run.Start();

            string savedAt = null;
            int step = 0;
            while (!run.Ended && run.Choices.Count > 0 && step++ < 200)
            {
                if (run.PendingExternal != null)
                {
                    Console.Error.WriteLine("    ✗ 外部事件未被解决,演出挂起");
                    return 1;
                }
                if (savedAt == null)
                {
                    savedAt = run.Snapshot();   // 在第一个选择点存档
                    Console.WriteLine("    ⌾ 已存档");
                }
                var labels = new List<string>();
                for (int i = 0; i < run.Choices.Count; i++) labels.Add($"{i + 1}.{run.Choices[i].Label}");
                Console.WriteLine($"    ▶ 选项:{string.Join("  ", labels)} → 选 1");
                run.Choose(0);
            }
            Console.WriteLine($"    演出{(run.Ended ? "结束" : "中断")} · 变量 {TheLoomJson.Stringify(run.Vars)}");

            if (savedAt != null)
            {
                Console.WriteLine("=== 读档后重放(结果应与上面一致)===");
                var replay = new TheLoomRuntime(pkg, flowRef);
                replay.Restore(savedAt);
                int replayStep = 0;
                while (!replay.Ended && replay.Choices.Count > 0 && replayStep++ < 200) replay.Choose(0);
                string a = TheLoomJson.Stringify(run.Vars);
                string b = TheLoomJson.Stringify(replay.Vars);
                Console.WriteLine($"    原始变量 {a}");
                Console.WriteLine($"    读档变量 {b}");
                if (a != b)
                {
                    Console.Error.WriteLine("    ✗ 读档后终值与原始不一致");
                    return 1;
                }
                Console.WriteLine("    ✓ 读档后终值一致");
            }

            Console.WriteLine("=== 演出验证通过 ===");
            return 0;
        }
    }
}
