# TheLoom · Unity 最小运行库(R20-4)

把 TheLoom 导出的引擎包直接放进 Unity 跑对白流程。

## 集成

把 `TheLoom/` 下的三个 `.cs` 拖进 `Assets/`(任意子目录):

| 文件 | 作用 |
|---|---|
| `TheLoomJson.cs` | 极简 JSON 解析与序列化 |
| `TheLoomScript.cs` | 条件 / 指令求值器 |
| `TheLoomRuntime.cs` | 运行库本体 |

**不依赖 UnityEngine,也不需要 Newtonsoft** —— Unity 的 `JsonUtility` 不支持字典与任意嵌套,所以这里自带解析器,和 TheLoom 一贯的「零第三方解析」保持一致。放进任何 Unity 版本的 Assets 都能直接编译。

## 用法

```csharp
using TheLoom;
using UnityEngine;

public class Storyteller : MonoBehaviour
{
    TheLoomRuntime run;

    void Start()
    {
        // theloom-package.json 放 Resources/ 下(去掉扩展名引用)
        var json = Resources.Load<TextAsset>("theloom-package").text;
        run = new TheLoomRuntime(json, "rain_night") { Seed = 42 };

        run.OnBeat = beat =>
        {
            if (beat.Kind == "dialogue") Debug.Log($"{beat.SpeakerName}:{beat.Text}");
        };
        run.OnExternalEvent = call =>
        {
            // 宿主执行引擎侧动作;ack / value 模式记得回调 ResolveExternal
            if (call.Name == "play_anim") { /* 播放动画 */ run.ResolveExternal(); }
        };

        run.Start();
        RenderChoices();
    }

    void RenderChoices()
    {
        for (int i = 0; i < run.Choices.Count; i++)
            Debug.Log($"选项 {i + 1}:{run.Choices[i].Label}");
    }

    public void OnChoiceClicked(int index)
    {
        run.Choose(index);
        RenderChoices();
        if (run.Ended) Debug.Log("演出结束");
    }
}
```

存读档:

```csharp
string save = run.Snapshot();          // 存成字符串,写 PlayerPrefs 或文件都行
run.Restore(save);                     // 读档;掷骰进度一并恢复,续掷不漂移
```

附件资源:包里 `assets[].fileName` 指向导出时同目录的 `assets/`(勾了「资源原文件随包」时)。把这些文件放进 `StreamingAssets/`,按 `fileName` 读取即可。

## 能力范围

**已具备**:数据加载、流程运行(与 TS / Godot 完全一致的行进语义)、选项、条件与指令脚本、检定(2d6 + 技能 vs 难度,红检定沿用首次结果)、种子化 RNG、子流程与出口引脚、fallback 遮蔽、一次性选项、存读档、外部事件回调(continue / ack / value 三种等待模式)。

**当前不含**:R19-2 的跨流程调用栈(`jump` / `call` / `return` 按装饰性节点处理,照常走出边并在 `Beat.Note` 里说明)。需要跨流程调用的项目暂时用 TS 运行库或 Godot 运行库。

## 语义验证

核心 `.cs` 不依赖 UnityEngine,所以能在纯 .NET 下跑对拍:

```bash
# 与 TS / Godot 共用同一份脚本语义夹具
dotnet run --project examples/unity-demo/conformance -- examples/godot-demo/script_fixture.json

# 用真实引擎包跑完整演出 + 存读档一致性
dotnet run --project examples/unity-demo/conformance -- --demo examples/godot-demo/sample_package.json demo_rain_night 42
```

三端(TypeScript / Godot / C#)对同一个包、同一种子产生完全相同的变量终值与掷骰序列,见仓库根 `docs/ENGINE_PARITY.md`。
