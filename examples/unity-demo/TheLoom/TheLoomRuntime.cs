using System;
using System.Collections.Generic;
using System.Linq;

namespace TheLoom
{
    /// <summary>演出记录:宿主拿它渲染对白框</summary>
    public sealed class Beat
    {
        public string Kind;
        public string Title;
        public string Text;
        public string SpeakerId;
        public string SpeakerName;
        public string Note;
    }

    /// <summary>当前可选项</summary>
    public sealed class Choice
    {
        public string Label;
        public string NodeId;
        public string EdgeId;
        public string Effect;
        public bool Once;
    }

    /// <summary>交给宿主处理的外部事件(R19-3):播动画、切场景、启动谜题等</summary>
    public sealed class ExternalEventCall
    {
        public string Name;
        public Dictionary<string, object> Args = new Dictionary<string, object>();
        /// <summary>continue 立即继续 / ack 等确认 / value 等回值</summary>
        public string Wait;
        public string FlowId;
        public string NodeId;
        public List<string> Path = new List<string>();
    }

    /// <summary>
    /// TheLoom 引擎包 · Unity 最小运行库
    ///
    /// 直接消费「工具 → 引擎包 .zip」导出的 theloom-package.json。
    /// **不依赖 UnityEngine**,把这几个 .cs 拖进 Assets 即可;
    /// 也能在纯 .NET 下跑(对拍测试就是这么验证语义的)。
    ///
    /// 行进语义与 TS 端 FlowRuntime、Godot 运行库一致:
    ///   直通节点自动前进、无出边逐层回溯、exit 走父层片段命名引脚、
    ///   fragment 默认引脚、fallback 遮蔽、一次性选项、条件边过滤、
    ///   检定 2d6+技能 vs 难度(红检定沿用首次结果)、mulberry32 种子 RNG。
    ///
    /// 当前范围(最小包):不含 R19-2 跨流程 call/return 的调用栈,
    /// jump / call 节点按装饰性节点处理并在 note 中说明;其余能力齐备。
    /// </summary>
    public sealed class TheLoomRuntime
    {
        public readonly List<Beat> Log = new List<Beat>();
        public List<Choice> Choices = new List<Choice>();
        public bool Ended;
        public Dictionary<string, object> Vars => env.Vars;
        public Dictionary<string, Dictionary<string, object>> EntityProps => env.EntityProps;
        public uint Seed;

        /// <summary>每产生一条演出记录时回调</summary>
        public Action<Beat> OnBeat;
        /// <summary>外部事件回调;wait 为 ack/value 时演出挂起,宿主处理完调用 ResolveExternal</summary>
        public Action<ExternalEventCall> OnExternalEvent;

        /// <summary>挂起中的外部事件;非 null 表示正在等宿主</summary>
        public ExternalEventCall PendingExternal { get; private set; }

        readonly Dictionary<string, object> package;
        readonly Dictionary<string, object> flow;
        readonly TheLoomScript.Env env = new TheLoomScript.Env();
        readonly Dictionary<string, string> techToId = new Dictionary<string, string>();
        readonly HashSet<string> seen = new HashSet<string>();
        readonly HashSet<string> taken = new HashSet<string>();
        readonly Dictionary<string, bool> checks = new Dictionary<string, bool>();
        readonly Dictionary<string, Dictionary<string, object>> entityById
            = new Dictionary<string, Dictionary<string, object>>();
        List<string> currentPath = new List<string>();
        uint rngState;
        int rolls;
        bool walking;
        string pendingResultVar;

        static readonly HashSet<string> AutoAdvance = new HashSet<string>
            { "hub", "instruction", "condition", "exit", "check", "event", "jump", "call", "return" };

        static readonly Dictionary<string, string> NodeLabel = new Dictionary<string, string>
        {
            { "dialogue", "对白" }, { "fragment", "剧情片段" }, { "hub", "汇聚点" },
            { "condition", "条件分支" }, { "instruction", "指令" }, { "jump", "跳转" },
            { "exit", "出口" }, { "check", "检定" }, { "event", "外部事件" },
            { "call", "调用" }, { "return", "返回" },
        };

        public TheLoomRuntime(string packageJson, string flowRef)
            : this(TheLoomJson.Parse(packageJson) as Dictionary<string, object>, flowRef) { }

        public TheLoomRuntime(Dictionary<string, object> pkg, string flowRef)
        {
            package = pkg ?? throw new ArgumentNullException(nameof(pkg));
            var flows = Get<List<object>>(package, "flows") ?? new List<object>();
            flow = flows.Cast<Dictionary<string, object>>().FirstOrDefault(f =>
                Str(f, "id") == flowRef || Str(f, "technicalName") == flowRef);
            if (flow == null) throw new ArgumentException("流程不存在:" + flowRef);

            foreach (var e in (Get<List<object>>(package, "entities") ?? new List<object>()).Cast<Dictionary<string, object>>())
                entityById[Str(e, "id")] = e;
            CollectTechNames(flow);
            env.Seen = tech => techToId.TryGetValue(tech, out string id) && seen.Contains(id);
            Seed = (uint)new Random().Next(1000, 999999);
        }

        void CollectTechNames(Dictionary<string, object> sub)
        {
            foreach (var node in Nodes(sub))
            {
                var data = Get<Dictionary<string, object>>(node, "data") ?? new Dictionary<string, object>();
                string tech = Str(data, "technicalName");
                if (tech.Length > 0) techToId[tech] = Str(node, "id");
                var inner = Get<Dictionary<string, object>>(data, "sub");
                if (inner != null) CollectTechNames(inner);
            }
        }

        /* ---------- 演出 ---------- */

        public void Start(string startNodeId = null)
        {
            rngState = Seed;
            rolls = 0;
            Log.Clear();
            Choices = new List<Choice>();
            Ended = false;
            PendingExternal = null;
            currentPath = new List<string>();
            seen.Clear();
            taken.Clear();
            checks.Clear();

            env.Vars.Clear();
            foreach (var v in (Get<List<object>>(package, "variables") ?? new List<object>()).Cast<Dictionary<string, object>>())
                env.Vars[Str(v, "name")] = CoerceVar(Str(v, "type"), Str(v, "value"));

            env.EntityProps.Clear();
            foreach (var e in entityById.Values)
            {
                string tech = Str(e, "technicalName");
                if (tech.Length == 0) continue;
                var props = new Dictionary<string, object>();
                foreach (var f in (Get<List<object>>(e, "fields") ?? new List<object>()).Cast<Dictionary<string, object>>())
                {
                    string label = Str(f, "label");
                    if (label.Length == 0) continue;
                    string type = Str(f, "type");
                    if (type == "entities") continue;
                    if (type == "entity")
                    {
                        string refId = Str(f, "value");
                        if (refId.Length > 0 && entityById.TryGetValue(refId, out var target))
                        {
                            string refTech = Str(target, "technicalName");
                            if (refTech.Length > 0) props[label] = refTech;
                        }
                        continue;
                    }
                    props[label] = CoerceScalar(Str(f, "value"));
                }
                env.EntityProps[tech] = props;
            }

            if (startNodeId != null && Nodes(flow).Any(n => Str(n, "id") == startNodeId))
            {
                Visit(new List<string>(), startNodeId);
                return;
            }
            var starts = StartNodes(flow);
            if (starts.Count == 0) { Ended = true; return; }
            if (starts.Count == 1) { Visit(new List<string>(), Str(starts[0], "id")); return; }
            Choices = starts.Select(n => new Choice
            {
                Label = Str(Get<Dictionary<string, object>>(n, "data"), "title") is string s && s.Length > 0
                    ? s : LabelOf(Str(n, "type")),
                NodeId = Str(n, "id"),
            }).ToList();
        }

        public void Choose(int index)
        {
            if (Ended || PendingExternal != null) return;
            if (index < 0 || index >= Choices.Count) return;
            var choice = Choices[index];
            if (choice.NodeId == null) return;
            if (choice.Once && choice.EdgeId != null) taken.Add(choice.EdgeId);
            if (!string.IsNullOrEmpty(choice.Effect)) TheLoomScript.ApplyInstructions(choice.Effect, env);
            Visit(currentPath, choice.NodeId);
        }

        /// <summary>宿主处理完外部事件后调用;value 模式可带回值</summary>
        public void ResolveExternal(object value = null)
        {
            if (PendingExternal == null) return;
            var call = PendingExternal;
            PendingExternal = null;
            if (pendingResultVar != null && value != null)
            {
                env.Vars[pendingResultVar] = value;
                pendingResultVar = null;
            }
            // 在行进循环内部被同步调用时只清状态,由循环自己继续,避免递归重入
            if (walking) return;
            var node = FindNode(currentPath, call.NodeId);
            if (node == null) { Ended = true; return; }
            ContinueFrom(currentPath, node);
        }

        void Visit(List<string> path, string nodeId)
        {
            var currentP = new List<string>(path);
            string id = nodeId;
            walking = true;
            try
            {
                for (int guard = 0; guard < 200 && id != null; guard++)
                {
                    var node = FindNode(currentP, id);
                    if (node == null) break;
                    seen.Add(id);
                    var data = Get<Dictionary<string, object>>(node, "data") ?? new Dictionary<string, object>();
                    string type = Str(node, "type");

                    switch (type)
                    {
                        case "dialogue":
                        {
                            string speakerId = Str(data, "speakerId");
                            entityById.TryGetValue(speakerId, out var speaker);
                            PushBeat(new Beat
                            {
                                Kind = "dialogue", Title = Str(data, "title"), Text = Str(data, "text"),
                                SpeakerId = speakerId.Length > 0 ? speakerId : null,
                                SpeakerName = speaker != null ? Str(speaker, "name") : null,
                            });
                            break;
                        }
                        case "fragment":
                        {
                            PushBeat(new Beat
                            {
                                Kind = "fragment",
                                Title = Str(data, "title").Length > 0 ? Str(data, "title") : "剧情片段",
                                Text = Str(data, "text"),
                            });
                            var inner = Get<Dictionary<string, object>>(data, "sub");
                            if (inner != null && Nodes(inner).Count > 0)
                            {
                                currentP.Add(Str(node, "id"));
                                var starts = StartNodes(inner);
                                if (starts.Count == 1) { id = Str(starts[0], "id"); continue; }
                                currentPath = currentP;
                                Choices = starts.Select(n => new Choice
                                {
                                    Label = Str(Get<Dictionary<string, object>>(n, "data"), "title") is string s && s.Length > 0
                                        ? s : LabelOf(Str(n, "type")),
                                    NodeId = Str(n, "id"),
                                }).ToList();
                                return;
                            }
                            break;
                        }
                        case "hub":
                            if (Str(data, "title").Length > 0)
                                PushBeat(new Beat { Kind = "hub", Title = Str(data, "title"), Text = "" });
                            break;
                        case "instruction":
                        {
                            var warnings = TheLoomScript.ApplyInstructions(Str(data, "text"), env);
                            PushBeat(new Beat
                            {
                                Kind = "instruction",
                                Title = Str(data, "title").Length > 0 ? Str(data, "title") : "指令",
                                Text = Str(data, "text"),
                                Note = warnings.Count > 0 ? string.Join(";", warnings) : null,
                            });
                            break;
                        }
                        case "condition":
                        {
                            bool? result = TheLoomScript.EvalCondition(Str(data, "text"), env);
                            PushBeat(new Beat
                            {
                                Kind = "condition",
                                Title = Str(data, "title").Length > 0 ? Str(data, "title") : "条件分支",
                                Text = Str(data, "text"),
                                Note = result == null ? "无法求值,请手动选择分支" : (result.Value ? "→ 真" : "→ 假"),
                            });
                            break;
                        }
                        case "exit":
                            PushBeat(new Beat
                            {
                                Kind = "exit",
                                Title = "⇥ 经「" + (Str(data, "title").Length > 0 ? Str(data, "title") : "出口") + "」离开子流程",
                                Text = "",
                            });
                            break;
                        case "check":
                        {
                            bool red = data.TryGetValue("checkRed", out object r) && r is bool rb && rb;
                            double dc = data.TryGetValue("checkDc", out object dcv) ? TheLoomScript.ToNum(dcv) : 10;
                            string note;
                            string nid = Str(node, "id");
                            if (red && checks.ContainsKey(nid))
                            {
                                note = "红色检定只有一次机会 → 沿用先前结果:" + (checks[nid] ? "成功" : "失败");
                            }
                            else
                            {
                                double skill = TheLoomScript.EvalNumber(Str(data, "checkExpr"), env);
                                int d1 = RollD6();
                                int d2 = RollD6();
                                rolls += 2;
                                bool passed = d1 + d2 + skill >= dc;
                                checks[nid] = passed;
                                note = string.Format("2d6 = {0}+{1},技能 {2},合计 {3} vs 难度 {4} → {5}",
                                    d1, d2, TheLoomJson.NumberToString(skill),
                                    TheLoomJson.NumberToString(d1 + d2 + skill),
                                    TheLoomJson.NumberToString(dc), passed ? "成功" : "失败");
                            }
                            PushBeat(new Beat
                            {
                                Kind = "check",
                                Title = (red ? "红色" : "白色") + "检定 · " +
                                    (Str(data, "title").Length > 0 ? Str(data, "title") : Str(data, "checkExpr")),
                                Text = Str(data, "text"),
                                Note = note,
                            });
                            break;
                        }
                        case "event":
                        {
                            var call = BuildExternalCall(currentP, node, data);
                            PushBeat(new Beat
                            {
                                Kind = "event",
                                Title = Str(data, "title").Length > 0 ? Str(data, "title") : ("外部事件 · " + call.Name),
                                Text = Str(data, "text"),
                                Note = "wait=" + call.Wait,
                            });
                            if (call.Wait == "ack" || call.Wait == "value")
                            {
                                // 先置挂起再通知宿主,宿主可以在回调里同步 ResolveExternal
                                currentPath = currentP;
                                PendingExternal = call;
                                pendingResultVar = call.Wait == "value" ? Str(data, "eventResultVar") : null;
                                OnExternalEvent?.Invoke(call);
                                if (PendingExternal != null) return;   // 宿主还没处理完 → 挂起
                            }
                            else
                            {
                                OnExternalEvent?.Invoke(call);
                            }
                            break;
                        }
                        case "jump":
                        case "call":
                        case "return":
                            // 最小包不含跨流程调用栈:按装饰性节点处理,照常走出边
                            PushBeat(new Beat
                            {
                                Kind = type,
                                Title = Str(data, "title").Length > 0 ? Str(data, "title") : LabelOf(type),
                                Text = Str(data, "text"),
                                Note = Str(data, "targetFlow").Length > 0
                                    ? "最小包未实现跨流程调用,按装饰性节点继续" : null,
                            });
                            break;
                    }

                    var outgoing = OutgoingChoices(currentP, node);
                    currentP = outgoing.Path;
                    if (outgoing.Choices.Count == 0)
                    {
                        currentPath = currentP;
                        Choices = new List<Choice>();
                        Ended = true;
                        return;
                    }
                    if (outgoing.Choices.Count == 1 && AutoAdvance.Contains(type))
                    {
                        var only = outgoing.Choices[0];
                        if (only.Once && only.EdgeId != null) taken.Add(only.EdgeId);
                        if (!string.IsNullOrEmpty(only.Effect)) TheLoomScript.ApplyInstructions(only.Effect, env);
                        id = only.NodeId;
                        continue;
                    }
                    currentPath = currentP;
                    Choices = outgoing.Choices;
                    return;
                }
                Choices = new List<Choice>();
                Ended = true;
            }
            finally { walking = false; }
        }

        /// <summary>外部事件解决后,从事件节点的出边继续</summary>
        void ContinueFrom(List<string> path, Dictionary<string, object> node)
        {
            var outgoing = OutgoingChoices(path, node);
            if (outgoing.Choices.Count == 0) { Ended = true; Choices = new List<Choice>(); return; }
            currentPath = outgoing.Path;
            if (outgoing.Choices.Count == 1)
            {
                var only = outgoing.Choices[0];
                if (only.Once && only.EdgeId != null) taken.Add(only.EdgeId);
                if (!string.IsNullOrEmpty(only.Effect)) TheLoomScript.ApplyInstructions(only.Effect, env);
                Visit(outgoing.Path, only.NodeId);
                return;
            }
            Choices = outgoing.Choices;
        }

        ExternalEventCall BuildExternalCall(List<string> path, Dictionary<string, object> node, Dictionary<string, object> data)
        {
            string name = Str(data, "eventName");
            var declared = (Get<List<object>>(package, "externalEvents") ?? new List<object>())
                .Cast<Dictionary<string, object>>()
                .FirstOrDefault(e => Str(e, "name") == name);
            var call = new ExternalEventCall
            {
                Name = name,
                Wait = Str(data, "eventWait").Length > 0 ? Str(data, "eventWait") : "continue",
                FlowId = Str(flow, "id"),
                NodeId = Str(node, "id"),
                Path = new List<string>(path),
            };
            var paramTypes = new Dictionary<string, string>();
            if (declared != null)
            {
                foreach (var p in (Get<List<object>>(declared, "params") ?? new List<object>()).Cast<Dictionary<string, object>>())
                    paramTypes[Str(p, "name")] = Str(p, "type");
            }
            foreach (var a in (Get<List<object>>(data, "eventArgs") ?? new List<object>()).Cast<Dictionary<string, object>>())
            {
                string argName = Str(a, "name");
                string expr = Str(a, "expr");
                paramTypes.TryGetValue(argName, out string type);
                // 与 TS/Godot 同口径:string 取字面量,boolean/number 走表达式
                if (type == "boolean") call.Args[argName] = TheLoomScript.EvalCondition(expr, env) ?? false;
                else if (type == "number") call.Args[argName] = TheLoomScript.EvalNumber(expr, env);
                else call.Args[argName] = expr;
            }
            return call;
        }

        struct Outgoing
        {
            public List<Choice> Choices;
            public List<string> Path;
        }

        Outgoing OutgoingChoices(List<string> path, Dictionary<string, object> node)
        {
            var currentP = new List<string>(path);
            var cur = node;
            string exitId = null;
            for (int guard = 0; guard < 64; guard++)
            {
                if (cur != null && Str(cur, "type") == "exit" && currentP.Count > 0)
                {
                    exitId = Str(cur, "id");
                    string fragId = currentP[currentP.Count - 1];
                    currentP.RemoveAt(currentP.Count - 1);
                    cur = FindNode(currentP, fragId);
                }
                var container = Container(currentP);
                var edges = cur == null
                    ? new List<Dictionary<string, object>>()
                    : Edges(container).Where(e => Str(e, "source") == Str(cur, "id")).ToList();

                if (exitId != null)
                {
                    var named = edges.Where(e => Str(e, "sourceHandle") == "exit:" + exitId).ToList();
                    edges = named.Count > 0 ? named : edges.Where(e => Str(e, "sourceHandle").Length == 0).ToList();
                    exitId = null;
                }
                else if (cur != null && Str(cur, "type") == "fragment")
                {
                    edges = edges.Where(e => Str(e, "sourceHandle").Length == 0).ToList();
                }

                if (cur != null && Str(cur, "type") == "condition")
                {
                    var data = Get<Dictionary<string, object>>(cur, "data") ?? new Dictionary<string, object>();
                    bool? result = TheLoomScript.EvalCondition(Str(data, "text"), env);
                    if (result != null)
                    {
                        string want = result.Value ? "true" : "false";
                        var picked = edges.Where(e => Str(e, "sourceHandle") == want).ToList();
                        edges = picked;
                    }
                }
                if (cur != null && Str(cur, "type") == "check")
                {
                    checks.TryGetValue(Str(cur, "id"), out bool passed);
                    string want = passed ? "success" : "fail";
                    edges = edges.Where(e => Str(e, "sourceHandle") == want).ToList();
                }

                var usable = edges.Where(e =>
                {
                    bool once = e.TryGetValue("once", out object o) && o is bool ob && ob;
                    if (once && taken.Contains(Str(e, "id"))) return false;
                    string condition = Str(e, "condition");
                    if (condition.Length > 0 && TheLoomScript.EvalCondition(condition, env) == false) return false;
                    return true;
                }).ToList();
                var nonFallback = usable.Where(e => !(e.TryGetValue("fallback", out object f) && f is bool fb && fb)).ToList();
                var final = nonFallback.Count > 0 ? nonFallback : usable;

                if (final.Count > 0)
                {
                    var container2 = Container(currentP);
                    return new Outgoing
                    {
                        Path = currentP,
                        Choices = final.Select(e =>
                        {
                            var target = Nodes(container2).FirstOrDefault(n => Str(n, "id") == Str(e, "target"));
                            string label = Str(e, "label");
                            if (label.Length == 0 && target != null)
                                label = Str(Get<Dictionary<string, object>>(target, "data"), "title");
                            if (label.Length == 0)
                                label = target != null ? LabelOf(Str(target, "type")) : "继续";
                            return new Choice
                            {
                                Label = label,
                                NodeId = Str(e, "target"),
                                EdgeId = Str(e, "id"),
                                Effect = Str(e, "effect"),
                                Once = e.TryGetValue("once", out object o2) && o2 is bool ob2 && ob2,
                            };
                        }).ToList(),
                    };
                }
                if (currentP.Count == 0) return new Outgoing { Path = currentP, Choices = new List<Choice>() };
                string fragId2 = currentP[currentP.Count - 1];
                currentP.RemoveAt(currentP.Count - 1);
                cur = FindNode(currentP, fragId2);
            }
            return new Outgoing { Path = currentP, Choices = new List<Choice>() };
        }

        /* ---------- 存读档 ---------- */

        public string Snapshot()
        {
            var state = new Dictionary<string, object>
            {
                { "seed", (double)Seed },
                { "rolls", (double)rolls },
                { "vars", new Dictionary<string, object>(env.Vars) },
                { "entityProps", env.EntityProps.ToDictionary(kv => kv.Key,
                    kv => (object)new Dictionary<string, object>(kv.Value)) },
                { "seen", seen.Cast<object>().ToList() },
                { "taken", taken.Cast<object>().ToList() },
                { "checks", checks.ToDictionary(kv => kv.Key, kv => (object)kv.Value) },
                { "curPath", currentPath.Cast<object>().ToList() },
                { "ended", Ended },
                { "choices", Choices.Select(c => (object)new Dictionary<string, object>
                    {
                        { "label", c.Label }, { "nodeId", c.NodeId }, { "edgeId", c.EdgeId },
                        { "effect", c.Effect }, { "once", c.Once },
                    }).ToList() },
                { "log", Log.Select(b => (object)new Dictionary<string, object>
                    {
                        { "kind", b.Kind }, { "title", b.Title }, { "text", b.Text },
                        { "speakerId", b.SpeakerId }, { "speakerName", b.SpeakerName }, { "note", b.Note },
                    }).ToList() },
            };
            if (PendingExternal != null)
            {
                state["pendingExternal"] = new Dictionary<string, object>
                {
                    { "name", PendingExternal.Name }, { "wait", PendingExternal.Wait },
                    { "nodeId", PendingExternal.NodeId }, { "resultVar", pendingResultVar },
                };
            }
            return TheLoomJson.Stringify(state);
        }

        public void Restore(string snapshotJson)
        {
            var state = TheLoomJson.Parse(snapshotJson) as Dictionary<string, object>;
            if (state == null) return;
            Seed = (uint)TheLoomScript.ToNum(state.GetValueOrDefault("seed"));
            rolls = (int)TheLoomScript.ToNum(state.GetValueOrDefault("rolls"));
            // RNG 快进到存档时的消耗位置,续掷不漂移
            rngState = Seed;
            for (int i = 0; i < rolls; i++) NextRandom();

            env.Vars.Clear();
            if (state.GetValueOrDefault("vars") is Dictionary<string, object> vars)
                foreach (var kv in vars) env.Vars[kv.Key] = kv.Value;

            env.EntityProps.Clear();
            if (state.GetValueOrDefault("entityProps") is Dictionary<string, object> props)
                foreach (var kv in props)
                    if (kv.Value is Dictionary<string, object> fields)
                        env.EntityProps[kv.Key] = new Dictionary<string, object>(fields);

            seen.Clear();
            foreach (var id in AsStrings(state.GetValueOrDefault("seen"))) seen.Add(id);
            taken.Clear();
            foreach (var id in AsStrings(state.GetValueOrDefault("taken"))) taken.Add(id);
            checks.Clear();
            if (state.GetValueOrDefault("checks") is Dictionary<string, object> savedChecks)
                foreach (var kv in savedChecks) checks[kv.Key] = kv.Value is bool b && b;

            currentPath = AsStrings(state.GetValueOrDefault("curPath")).ToList();
            Ended = state.GetValueOrDefault("ended") is bool e && e;

            Choices = new List<Choice>();
            if (state.GetValueOrDefault("choices") is List<object> savedChoices)
                foreach (var c in savedChoices.Cast<Dictionary<string, object>>())
                    Choices.Add(new Choice
                    {
                        Label = Str(c, "label"), NodeId = Str(c, "nodeId"),
                        EdgeId = Str(c, "edgeId").Length > 0 ? Str(c, "edgeId") : null,
                        Effect = Str(c, "effect"),
                        Once = c.GetValueOrDefault("once") is bool o && o,
                    });

            Log.Clear();
            if (state.GetValueOrDefault("log") is List<object> savedLog)
                foreach (var b in savedLog.Cast<Dictionary<string, object>>())
                    Log.Add(new Beat
                    {
                        Kind = Str(b, "kind"), Title = Str(b, "title"), Text = Str(b, "text"),
                        SpeakerId = Str(b, "speakerId").Length > 0 ? Str(b, "speakerId") : null,
                        SpeakerName = Str(b, "speakerName").Length > 0 ? Str(b, "speakerName") : null,
                        Note = Str(b, "note").Length > 0 ? Str(b, "note") : null,
                    });

            PendingExternal = null;
            pendingResultVar = null;
            if (state.GetValueOrDefault("pendingExternal") is Dictionary<string, object> pending)
            {
                PendingExternal = new ExternalEventCall
                {
                    Name = Str(pending, "name"), Wait = Str(pending, "wait"), NodeId = Str(pending, "nodeId"),
                    FlowId = Str(flow, "id"), Path = new List<string>(currentPath),
                };
                pendingResultVar = Str(pending, "resultVar").Length > 0 ? Str(pending, "resultVar") : null;
            }
        }

        /* ---------- mulberry32(与 TS / Godot 位模一致) ---------- */

        double NextRandom()
        {
            unchecked
            {
                rngState += 0x6D2B79F5u;
                uint t = rngState;
                t = (uint)((t ^ (t >> 15)) * (t | 1u));
                t ^= t + (uint)((t ^ (t >> 7)) * (t | 61u));
                return ((t ^ (t >> 14)) >> 0) / 4294967296.0;
            }
        }

        int RollD6() => (int)Math.Floor(NextRandom() * 6) + 1;

        /* ---------- 小工具 ---------- */

        void PushBeat(Beat beat)
        {
            Log.Add(beat);
            OnBeat?.Invoke(beat);
        }

        static object CoerceVar(string type, string value)
        {
            if (type == "boolean") return value == "true";
            if (type == "number") return double.TryParse(value, out double d) ? d : 0d;
            return value ?? "";
        }

        static object CoerceScalar(string raw)
        {
            string v = (raw ?? "").Trim();
            if (v == "true") return true;
            if (v == "false") return false;
            if (v.Length > 0 && double.TryParse(v, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out double d)) return d;
            return raw ?? "";
        }

        static string LabelOf(string type) => NodeLabel.TryGetValue(type, out string label) ? label : type;

        Dictionary<string, object> Container(List<string> path)
        {
            var current = flow;
            foreach (string id in path)
            {
                var node = Nodes(current).FirstOrDefault(n => Str(n, "id") == id);
                if (node == null) return new Dictionary<string, object>();
                var data = Get<Dictionary<string, object>>(node, "data");
                var inner = data == null ? null : Get<Dictionary<string, object>>(data, "sub");
                if (inner == null) return new Dictionary<string, object>();
                current = inner;
            }
            return current;
        }

        Dictionary<string, object> FindNode(List<string> path, string id)
            => Nodes(Container(path)).FirstOrDefault(n => Str(n, "id") == id);

        static List<Dictionary<string, object>> Nodes(Dictionary<string, object> sub)
            => (Get<List<object>>(sub, "nodes") ?? new List<object>()).Cast<Dictionary<string, object>>().ToList();

        static List<Dictionary<string, object>> Edges(Dictionary<string, object> sub)
            => (Get<List<object>>(sub, "edges") ?? new List<object>()).Cast<Dictionary<string, object>>().ToList();

        static List<Dictionary<string, object>> StartNodes(Dictionary<string, object> sub)
        {
            var incoming = new HashSet<string>(Edges(sub).Select(e => Str(e, "target")));
            var story = Nodes(sub).Where(n => Str(n, "type") != "note" && Str(n, "type") != "zone").ToList();
            var starts = story.Where(n => !incoming.Contains(Str(n, "id"))).ToList();
            return starts.Count > 0 ? starts : story;
        }

        static T Get<T>(Dictionary<string, object> map, string key) where T : class
            => map != null && map.TryGetValue(key, out object v) ? v as T : null;

        static string Str(Dictionary<string, object> map, string key)
            => map != null && map.TryGetValue(key, out object v) && v is string s ? s : "";

        static IEnumerable<string> AsStrings(object value)
            => value is List<object> list ? list.OfType<string>() : Enumerable.Empty<string>();
    }
}
