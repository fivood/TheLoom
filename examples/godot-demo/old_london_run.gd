extends SceneTree

## 《老伦敦寻人记》示例包的 Godot 端一致性检查(R22-1)。
## 与 TS / C# 用同一个包、同一种子、同一选择策略(永远选第 1 项)对拍。
##
##   godot --headless --path examples/godot-demo --script old_london_run.gd

func _initialize() -> void:
	var text := FileAccess.get_file_as_string("res://old_london_package.json")
	var pkg = JSON.parse_string(text)
	if typeof(pkg) != TYPE_DICTIONARY:
		printerr("✗ 读不到 old_london_package.json(先跑 CLI 导出示例包)")
		quit(1)
		return

	var run = TheLoomRuntime.new(pkg, "old_london_case")
	run.seed_val = 7
	run.start()
	var guard := 0
	while not run.ended and run.choices.size() > 0 and guard < 200:
		guard += 1
		run.choose(0)

	var names = run.vars.keys()
	names.sort()
	var pairs: Array = []
	for name in names:
		pairs.append('"%s":%s' % [name, _json_value(run.vars[name])])
	print('{"vars":{%s},"beats":%d}' % [",".join(pairs), run.log.size()])
	quit(0)


func _json_value(v) -> String:
	match typeof(v):
		TYPE_BOOL: return "true" if v else "false"
		TYPE_INT: return str(v)
		TYPE_FLOAT:
			var f: float = v
			return str(int(f)) if fposmod(f, 1.0) == 0.0 else str(f)
		_: return JSON.stringify(str(v))
