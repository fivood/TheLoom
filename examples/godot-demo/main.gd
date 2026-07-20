extends Control

## TheLoom · Godot 4 演出示例
##
## 加载 res://sample_package.json(等价于 TheLoom「工具 → 引擎包」导出的
## theloom-package.json),用 TheLoomRuntime 演出一条流程。
## 顶部显示项目名与种子,中间是滚动日志,底部动态生成选项按钮。

@onready var _log: RichTextLabel = $Panel/Vbox/Log
@onready var _choices_box: VBoxContainer = $Panel/Vbox/Choices
@onready var _header: Label = $Panel/Vbox/Header
@onready var _replay: Button = $Panel/Vbox/Replay

var _runtime: TheLoomRuntime


func _ready() -> void:
	_replay.pressed.connect(_start)
	_start()


func _start() -> void:
	var text := FileAccess.get_file_as_string("res://sample_package.json")
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		_log.text = "[color=#c33]无法解析引擎包 JSON[/color]"
		return
	var pkg: Dictionary = parsed
	# 取第一条流程演出;真实项目里可用技术名点选
	var flow_ref: String = pkg.get("flows", [{}])[0].get("technicalName", "")
	if flow_ref == "":
		flow_ref = pkg.get("flows", [{}])[0].get("id", "")
	_runtime = TheLoomRuntime.new(pkg, flow_ref)
	_runtime.seed_val = 42
	_runtime.beat_added.connect(_on_beat)

	_log.clear()
	_header.text = "▶ %s · 流程 %s · 种子 %d" % [pkg.get("meta", {}).get("projectName", "示例"), flow_ref, _runtime.seed_val]
	_runtime.start()
	_render_choices()


func _on_beat(beat: Dictionary) -> void:
	var kind: String = beat.get("kind", "")
	var speaker: String = beat.get("speaker_name", "")
	var title: String = beat.get("title", "")
	var text: String = beat.get("text", "")
	var note: String = beat.get("note", "")
	var head := ""
	match kind:
		"dialogue":
			head = "[color=#c9945f][b]【%s】[/b][/color] " % (speaker if speaker != "" else (title if title != "" else "旁白"))
		"hub":
			head = "[color=#7aa77a]〔汇聚〕[/color] "
		"instruction":
			head = "[color=#7f97b8]〔指令〕[/color] "
		"condition":
			head = "[color=#a179c9]〔条件〕[/color] "
		"check":
			head = "[color=#c8794f]〔检定〕[/color] "
		"fragment":
			head = "[color=#8e8e8e]〔片段 %s〕[/color] " % title
		"jump":
			head = "[color=#8e8e8e]〔跳转〕[/color] "
		"exit":
			head = "[color=#8e8e8e]%s[/color] " % title
		_:
			head = "[color=#8e8e8e]〔%s〕[/color] " % kind
	_log.append_text(head + text)
	if note != "":
		_log.append_text("  [color=#8e8e8e][i]// %s[/i][/color]" % note)
	_log.append_text("\n")


func _render_choices() -> void:
	# 清空旧按钮
	for child in _choices_box.get_children():
		child.queue_free()
	if _runtime.ended:
		var end_label := Label.new()
		end_label.text = "— 演出结束 —  变量:%s" % JSON.stringify(_runtime.vars)
		end_label.modulate = Color(0.6, 0.6, 0.6)
		_choices_box.add_child(end_label)
		return
	for i in _runtime.choices.size():
		var c: Dictionary = _runtime.choices[i]
		var btn := Button.new()
		btn.text = "%d. %s" % [i + 1, c.get("label", "继续")]
		var idx := i
		btn.pressed.connect(func():
			_runtime.choose(idx)
			_render_choices()
		)
		_choices_box.add_child(btn)
