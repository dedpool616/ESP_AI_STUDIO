# ESP AI Studio — Project Context / Handoff

## 1. Что это за проект

Название программы: **ESP AI Studio**

Это Windows desktop-приложение для разработки проектов под ESP32 с глубокой интеграцией AI.

Основная идея — сделать собственную IDE/среду разработки, ориентированную прежде всего на ESP-IDF, в которой пользователь может:

- писать код вручную;
- работать полностью без AI;
- подключать AI только тогда, когда он нужен;
- просить AI написать или изменить код;
- собирать проект;
- прошивать ESP32;
- запускать Serial Monitor;
- анализировать ошибки Build/Flash/Monitor;
- управлять GPIO;
- работать с Git;
- хранить контекст конкретного проекта;
- позволять AI выполнять действия только после подтверждения пользователя.

ESP AI Studio должна быть настоящей самостоятельной программой Windows, а не просто оболочкой вокруг VS Code.

Первоначально основной фокус — ESP-IDF.

В перспективе должна поддерживаться вся линейка ESP32:

- ESP32
- ESP32-S2
- ESP32-S3
- ESP32-C3
- ESP32-C6
- и другие ESP32 target'ы.

Главная тестовая плата разработчика сейчас — ESP32-S3.


# 2. Репозиторий и локальная среда

Локальный проект:

C:\ESP_AI_STUDIO

GitHub:

https://github.com/dedpool616/ESP_AI_STUDIO.git

Основная ветка:

main

Текущая feature-ветка:

feature/project-storage

Эту ветку нельзя считать завершённой, пока не закончено хранение состояния проектов и редактора.

Используемые версии во время разработки:

Node.js:
v24.19.0

npm:
11.17.0

Из-за PowerShell execution policy команды npm обычно запускаются через:

npm.cmd

Например:

npm.cmd install
npm.cmd run dev
npm.cmd run typecheck


# 3. Технологический стек

Приложение построено на:

- Electron
- React
- TypeScript
- Node.js в Electron main process
- Monaco Editor
- electron-vite

Проект был создан через:

@quick-start/create-electron

React + TypeScript template.

Monaco:

@monaco-editor/react
monaco-editor

Используются локальные Monaco workers.

Правильные imports сейчас выглядят примерно так:

import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

НЕ возвращаться к старым путям вида:

monaco-editor/esm/vs/...

так как с ними уже были проблемы.


# 4. Архитектурный принцип

Electron renderer не должен получать unrestricted доступ к Windows/Node.

Архитектура должна оставаться примерно такой:

React Renderer
        ↓
window.api
        ↓
secure preload
        ↓
IPC
        ↓
Electron Main / Node backend
        ↓
File System / Git / ESP-IDF / Serial / etc.

Файловые операции, процессы, Git, ESP-IDF и системные операции должны выполняться через main process/backend.

Не переносить произвольно Node/file-system доступ непосредственно в renderer.

В дальнейшем для постоянных данных планируется SQLite.

На текущем этапе некоторые данные хранятся в JSON, например app-state.json.

Это сделано специально как простой первый этап. Backend хранения позже можно заменить на SQLite, не переписывая весь UI.


# 5. Общая концепция интерфейса

Темная тема — основная по умолчанию.

Светлая тема должна появиться позже.

Основной язык интерфейса:

Русский.

Также позже нужен английский интерфейс.

Интерфейс должен быть профессиональным, но понятным новичку.

Основные страницы/разделы:

- Home
- Dashboard
- AI
- Code Editor
- AI + Code
- Pin Manager
- Monitor
- Terminal
- Git
- Activity
- User Guide
- Settings

В будущем может появиться:

- Schematic / graphical hardware editor

но он отложен на более поздний этап.


# 6. Home и Dashboard

Было принято важное UX-решение:

Home и Dashboard — НЕ одно и то же.

Home — стартовая страница приложения.

Она содержит:

- Welcome
- New Project
- Open Project
- Recent Projects

Home должна быть доступна всегда, даже когда проект уже открыт.

Переход на Home НЕ должен закрывать текущий проект.

Dashboard относится к открытому проекту.

Dashboard появляется в navigation только когда есть currentProject.

После:

- New Project
- Open Project
- выбора проекта из Recent Projects

пользователь автоматически попадает на Dashboard.

Но потом может нажать Home и вернуться на стартовую страницу, не закрывая проект.

После перезапуска приложения:

- activePage начинается с Home;
- последний проект может быть восстановлен в фоне;
- пользователь всё равно видит стартовую страницу.


# 7. Project model

ESP AI Studio работает с обычным ESP-IDF проектом.

Мы НЕ хотим создавать какой-то полностью несовместимый собственный формат проекта.

Минимальный ESP-IDF проект содержит примерно:

CMakeLists.txt
main/
    CMakeLists.txt
    main.c
.gitignore

Для внутренних данных ESP AI Studio используется:

.espai/

Например:

.espai/project.json

Эта папка скрывается из обычного Project Tree пользователя.


# 8. Метаданные проекта

При создании проекта ESP AI Studio создаёт:

.espai/project.json

В нём сейчас сохраняются как минимум:

- board
- idfVersion

Например концептуально:

{
  "board": "esp32s3",
  "idfVersion": "recommended"
}

При Open Project программа пытается определить Board и ESP-IDF version из нескольких источников.

Приоритет примерно следующий:

1. .espai/project.json
2. build/project_description.json
3. sdkconfig

Если проект был создан не ESP AI Studio, отсутствие .espai/project.json не должно мешать его открыть.

То есть обычные существующие ESP-IDF проекты тоже должны поддерживаться.


# 9. New Project

New Project уже реализован на базовом уровне.

Пользователь выбирает:

- имя проекта;
- директорию;
- board;
- ESP-IDF version;
- Git mode.

Минимальный ESP-IDF проект создаётся реально на диске.

Создаются:

CMakeLists.txt
main/CMakeLists.txt
main/main.c
.gitignore
.espai/project.json

В main.c используется простой стартовый код, например Hello from ESP AI Studio.

Git modes:

local
github
none

Local Git уже может выполнять:

git init
git branch -M main

GitHub integration пока НЕ завершена.

Режим github пока не должен притворяться рабочим, если реальной интеграции ещё нет.


# 10. Open Project

Open Project уже реализован.

Пользователь выбирает существующую папку проекта.

Программа проверяет ESP-IDF проект и загружает его.

После открытия проект добавляется в Recent Projects.

Recent Projects сейчас ограничиваются примерно 8 последними проектами.

При повторном открытии одного и того же пути не нужно создавать дубликаты.


# 11. Persistent App State

В feature/project-storage реализовано сохранение общего состояния приложения.

Используются IPC:

storage:load-app-state
storage:save-app-state

Renderer использует примерно:

window.api.loadAppState()
window.api.saveAppState(...)

Состояние записывается в Electron userData в:

app-state.json

Сейчас туда сохраняются:

currentProject
recentProjects

Это уже работает.

Ранее был баг:

No handler registered for 'storage:load-app-state'
No handler registered for 'storage:save-app-state'

Причина была в том, что storage IPC handlers случайно находились внутри:

dialog:select-folder

Они были вынесены наружу и теперь регистрируются при запуске приложения.

Не возвращать handlers внутрь других IPC handlers.


# 12. Code Editor

Code Editor уже имеет рабочую базу.

Используется Monaco Editor.

Есть:

- Project Tree
- открытие файлов
- несколько вкладок
- активная вкладка
- dirty indicator
- изменение содержимого
- сохранение
- Ctrl+S
- закрытие вкладок
- предупреждение при закрытии изменённого файла
- Monaco language selection
- локальные Monaco workers

Open file хранится примерно как:

interface OpenFile {
  name: string
  relativePath: string
  content: string
  savedContent: string
}

Dirty определяется сравнением:

content !== savedContent


# 13. Важный принцип Code Editor — keep alive

CodeEditorPage специально не должен полностью unmount'иться каждый раз, когда пользователь переходит на другую страницу IDE.

Используется концепция:

code-editor-keep-alive

То есть CodeEditorPage остаётся смонтированным, а UI показывается/скрывается через activePage.

Это было сделано, чтобы не терять вкладки и состояние редактора при переходе:

Code Editor → Home → Code Editor

Не заменять это простым условным render/unmount без причины.


# 14. Уже исправленный критический Monaco bug

Был важный баг при переключении между разными проектами.

Например:

Project1/CMakeLists.txt
Project2/CMakeLists.txt

В Monaco использовалось:

path={activeFile.relativePath}

Из-за этого для Monaco оба файла имели один ID:

CMakeLists.txt

В результате текст из файла Project 1 мог временно появляться в Project 2.

То же происходило с:

.gitignore
main/CMakeLists.txt
main/main.c

Этот баг исправлен.

Теперь Monaco path включает projectPath.

Используется концепция примерно:

path={
  projectPath
    ? `espai://project/${encodeURIComponent(
        projectPath
      )}/${activeFile.relativePath.replace(
        /\\/g,
        '/'
      )}`
    : activeFile.relativePath
}

Таким образом Monaco models разных проектов уникальны.

НЕ возвращать Monaco path обратно только к relativePath.


# 15. Текущее ограничение редактора

На данный момент при переключении:

Project 1 → Project 2

CodeEditorPage меняет projectPath и очищает:

openFiles
activeFilePath

Поэтому вкладки проекта закрываются.

Смешивания текста между проектами уже нет.

Но ещё НЕ завершено хранение отдельных editor sessions для каждого проекта.

Следующая задача в feature/project-storage:

каждый проект должен иметь собственное editor state:

Project 1
- openFiles
- activeFilePath
- unsaved contents

Project 2
- openFiles
- activeFilePath
- unsaved contents

При переходе:

Project 1 → Project 2 → Project 1

должны восстановиться:

- вкладки Project 1;
- активная вкладка;
- несохранённый текст.

После этого эти editor sessions нужно сохранить также в app-state.json, чтобы они восстанавливались после полного закрытия/запуска приложения.

В перспективе туда можно добавить:

- cursor position;
- scroll position;
- expanded folders;
- panel sizes.


# 16. Unsaved files

Несохранённые данные нужно обрабатывать очень осторожно.

Пользователь не должен терять изменения без предупреждения.

Уже существует custom close confirmation для dirty file.

Ранее использовались native:

window.confirm
window.alert

Native browser dialogs создавали проблемы с focus/keyboard в Electron/Monaco.

Поэтому для новых UX-сценариев нужно использовать собственные React dialogs / inline errors.

Уже исправлено:

при отсутствии Project Name или Project Location New Project показывает inline projectFormError вместо native alert.

Некоторые window.alert в старых error paths ещё остались и позже должны быть заменены собственными UI dialogs/errors.


# 17. Project Tree

Project Tree уже получает дерево проекта через backend.

Некоторые папки скрываются, например:

.git
.espai
node_modules
build
out

.espai не должна отображаться пользователю как обычная папка исходного проекта.

Файлы читаются/сохраняются через backend с path validation.

Не давать renderer произвольный небезопасный доступ к файловой системе.


# 18. AI — общая идея

AI — одна из главных функций продукта, но IDE должна полностью работать без него.

AI должен быть глобальным помощником и быть доступен из разных частей IDE.

Планируются:

- отдельная страница AI Chat;
- страница AI + Code;
- AI доступный из Code Editor;
- анализ Build errors;
- анализ Flash errors;
- анализ Serial Monitor;
- объяснение выделенного кода;
- Fix;
- Optimize;
- Ask AI;
- генерация файлов;
- изменение файлов;
- работа с Project Memory;
- Pin Manager context;
- Git context;
- board/IDF context;
- current project context.

AI должен понимать текущий проект, а не отвечать как отдельный обычный чат.


# 19. AI Providers

Предпочтительный AI:

ChatGPT.

Если существует официальный способ использовать аккаунт ChatGPT Plus/Pro без отдельной API оплаты, он предпочтителен.

Но нельзя строить архитектуру на неподтверждённом предположении, что Plus/Pro автоматически даёт API.

Gemini планируется как fallback, особенно если доступен официальный бесплатный вариант.

Claude был исключён из первоначального набора.

Локальные модели пока отложены, но архитектура должна позволить добавить их позже.

Должен быть manual provider/model selection.

История чата одного provider НЕ должна автоматически передаваться другому provider без явной архитектурной логики.


# 20. AI actions и подтверждения — КРИТИЧЕСКОЕ ПРАВИЛО

Это одно из главных требований продукта.

AI может читать текущий проект и анализировать контекст без постоянных подтверждений.

Но любые действия, изменяющие состояние, требуют подтверждения пользователя.

Требовать confirmation перед:

- изменением файлов;
- созданием файлов;
- удалением файлов;
- установкой dependencies;
- изменением Project Memory;
- изменением Pin Manager;
- Build;
- Flash;
- Monitor open;
- Erase Flash;
- системными изменениями;
- Git commit;
- Git push;
- изменением branch;
- другими действиями, способными изменить проект или систему.

Erase Flash требует особенно явного подтверждения.

AI никогда не должен молча редактировать проект.


# 21. AI Code Editing

Для AI editing планируется workflow:

AI предлагает изменение
        ↓
Before / After diff
        ↓
пользователь проверяет
        ↓
Apply

Также позже можно добавить Real-time apply, но только после разрешения пользователя.

Должна быть возможность:

Undo / Ctrl+Z

AI должен сообщать:

- что изменил;
- какие файлы;
- почему;
- результат.

Нужна кнопка Stop AI для остановки длинной операции.


# 22. AI Auto Fix

AI должен уметь:

Build
↓
получить errors
↓
проанализировать
↓
предложить fix
↓
после подтверждения изменить код
↓
повторить Build

Количество автоматических попыток должно быть configurable.

После завершения AI показывает:

- какие ошибки были;
- что он изменил;
- сколько попыток было;
- удалось ли собрать проект.

Никаких бесконечных auto-fix loops.


# 23. AI и документация

AI в будущем должен иметь возможность искать информацию в интернете.

При технических вопросах по ESP-IDF/ESP32 приоритет:

официальная документация Espressif.

Также возможно использование:

- datasheets;
- GitHub;
- документации библиотек;
- пользовательских PDF;
- images;
- attachments.

В Chat планируется поддержка файлов и изображений.


# 24. Project Memory

Каждый проект должен иметь отдельную Project Memory.

Она содержит структурированную информацию, например:

- board;
- используемые GPIO;
- подключённые устройства;
- библиотеки;
- требования проекта;
- архитектурные решения;
- ограничения;
- важные пользовательские пожелания.

Project Memory должна быть видима пользователю и редактируема.

AI может предложить добавить информацию в Project Memory, но изменение выполняется только после подтверждения пользователя.

Project Memory одного проекта не должна смешиваться с другим.


# 25. Pin Manager

Одна из будущих основных функций.

Pin Manager должен:

- показывать выбранную ESP32 board;
- отображать доступные GPIO;
- позволять назначать функции;
- хранить назначения;
- предупреждать о конфликтах;
- учитывать reserved/boot/USB/etc. pins;
- передавать pin context AI.

Например:

HX711 #1
DOUT → GPIO13
CLK → GPIO12

AI должен видеть Pin Manager и предупреждать:

"GPIO уже используется"

или:

"этот GPIO нежелателен для этой функции".

Позже Pin Manager может быть связан с graphical schematic.


# 26. Build / ESP-IDF

Следующий большой subsystem после project storage — ESP-IDF Manager.

Программа должна уметь:

- обнаруживать установленный ESP-IDF;
- определять версию;
- выбирать версию;
- определять toolchain;
- понимать target;
- проверять Python;
- CMake;
- Ninja;
- Git;
- ESP-IDF environment.

После этого реализовать настоящие команды:

Build
Full Clean
Menuconfig
Size

Output должен отображаться внутри программы.

Ошибки Build должны по возможности парситься в:

file
line
column
message

и быть clickable, чтобы открыть соответствующую строку Code Editor.


# 27. Flash

После Build subsystem:

- обнаружение COM ports;
- выбор COM;
- board/device status;
- Flash;
- Build & Flash;
- Erase Flash;
- Stop.

Flash запускается только после подтверждения пользователя, если действие инициирует AI.

Для Erase Flash нужно более сильное подтверждение.


# 28. Serial Monitor

Нужен встроенный Serial Monitor.

Функции:

- Start;
- Stop;
- Baud Rate;
- Clear;
- Send text;
- receive serial output;
- bounded buffer;
- save log;
- AI analysis.

Позже возможна цепочка:

Build → Flash → Monitor

Ошибки из Monitor AI должен уметь анализировать.


# 29. Bottom Panel

В Code Editor уже концептуально существуют вкладки:

Problems
Output
Terminal
Monitor

В дальнейшем это должен стать полноценный VS Code-подобный нижний panel.

Panels должны быть resizable.


# 30. Terminal

Нужен встроенный Terminal.

Он должен использовать environment выбранного проекта/ESP-IDF.

Не давать renderer прямой shell access — команды должны проходить через контролируемый backend.


# 31. Git

Git является полноценной частью будущей IDE.

Должны быть:

- git status;
- diff;
- branch;
- create branch;
- commit;
- push;
- pull;
- history;
- restore/checkpoint.

UI должен иметь простой режим для новичка и более advanced capabilities.

AI должен иметь Git context.

Перед крупным AI изменением можно создавать safety checkpoint.

Важно различать:

Editor Undo

и

Git checkpoint/restore.

Commit и Push через AI выполняются только после подтверждения пользователя.

GitHub login/integration — отдельная будущая задача.


# 32. Multi-project

Программа работает с несколькими проектами через Recent Projects.

Каждый проект должен иметь своё состояние:

- Project Memory;
- Chat history;
- settings;
- Pin Manager;
- Code Editor session;
- Git state/context;
- board;
- IDF;
- другие project-specific данные.

Нельзя смешивать состояния разных проектов.

Это важное архитектурное требование.


# 33. AI Chat

У каждого проекта в будущем может быть несколько именованных AI chats.

Chat history должна сохраняться локально.

Нужен поиск по истории.

При открытии другого проекта пользователь должен видеть chats именно этого проекта.

AI может быть доступен глобально, но project context всегда должен быть явным.


# 34. Settings

Будущая Settings page должна включать как минимум:

- Theme;
- Language;
- AI provider;
- model;
- ESP-IDF path/version;
- Build preferences;
- Flash preferences;
- AI auto-fix attempt count;
- editor preferences;
- confirmation options;
- possibly Git/GitHub settings.

Но критические destructive actions нельзя полностью делать бесконтрольными.


# 35. Installer

Финальная цель — нормальный Windows installer:

Setup.exe

Поддержка:

Windows 10
Windows 11

Программа должна уметь подготовить или проверить окружение.

Желаемый first-run workflow:

ESP AI Studio запускается
↓
Environment Check
↓
проверяет:
ESP-IDF
Python
Git
CMake
Ninja
drivers/tools
↓
помогает установить недостающие компоненты

Идея — использовать изолированное app-managed environment насколько это разумно, чтобы пользователю не приходилось вручную настраивать десятки системных переменных.

Первоначально installer может быть online/bootstrap.

Offline installer можно добавить позже.


# 36. First-run / AI setup

В будущем возможна кнопка:

"AI настроить всё"

которая поможет пользователю настроить environment.

Но любые реальные installations/system changes должны быть показаны пользователю и подтверждены.


# 37. User Guide

В приложение должен входить встроенный User Guide.

Также нужен Quick Start.

Программа ориентирована в том числе на пользователя, который может не знать:

- ESP-IDF structure;
- CMake;
- toolchains;
- COM;
- flashing;
- Git.

Поэтому UI не должен предполагать expert knowledge.


# 38. UI details

Пользователь хочет:

- resizable panels;
- возможность скрыть Project Tree;
- настраиваемое расположение AI/Code;
- Search;
- Find/Replace;
- keyboard shortcuts;
- themes;
- понятные status indicators;
- текущую board;
- COM;
- IDF;
- AI status.

Start page должна оставаться отдельной от project Dashboard.


# 39. Уже реализованные важные функции

На текущем этапе подтверждено, что работают:

- Electron приложение;
- React UI;
- sidebar/navigation;
- Home;
- Dashboard;
- New Project modal;
- выбор Windows directory;
- создание минимального ESP-IDF проекта;
- local Git init;
- Open Project;
- Recent Projects;
- persistent currentProject;
- persistent Recent Projects;
- app-state.json;
- .espai/project.json;
- board/idf detection;
- Project Tree;
- чтение файлов;
- сохранение файлов;
- Monaco Editor;
- multiple editor tabs;
- dirty state;
- Ctrl+S;
- custom dirty-close confirmation;
- local Monaco workers;
- Code Editor keep-alive;
- Home/Dashboard separation;
- уникальные Monaco models для одинаковых файлов разных проектов.

TypeScript typecheck проходил после последних подтверждённых изменений.


# 40. Уже исправленные важные баги

### Native dialog focus bug

window.confirm / некоторые native dialogs могли ломать keyboard focus в Electron/Monaco.

Для dirty-close сделан custom React dialog.

Для обязательных полей New Project сделан inline projectFormError.

Не возвращать native confirmation для подобных сценариев.

### Project metadata

Board/IDF раньше терялись при повторном открытии проекта.

Добавлен:

.espai/project.json

и fallback detection.

### .espai in tree

Internal .espai folder скрыта из Project Tree.

### app-state IPC registration

storage handlers были ошибочно вложены в select-folder handler.

Исправлено.

### Monaco cross-project file contamination

Одинаковые relativePath в разных проектах создавали одну Monaco model.

Исправлено через project-specific Monaco path.


# 41. Текущее состояние feature/project-storage

Уже работает:

- сохранение currentProject;
- сохранение Recent Projects;
- восстановление после перезапуска ESP AI Studio;
- Home остаётся стартовой страницей;
- currentProject может быть восстановлен в фоне.

Ещё нужно закончить:

1. отдельные Code Editor sessions для каждого проекта;
2. восстановление open tabs;
3. восстановление active tab;
4. сохранение unsaved editor buffers при переключении проектов;
5. persistence editor sessions после перезапуска приложения;
6. корректная работа, если Recent Project был удалён или перемещён;
7. Close Project;
8. решить, какие UI states ещё сохранять.

ВАЖНО:

Было предложено использовать ProjectEditorSession:

interface ProjectEditorSession {
  openFiles: OpenFile[]
  activeFilePath: string | null
}

и хранить editor sessions отдельно для каждого projectPath.

Но перед реализацией Codex должен сначала проверить текущий CodeEditorPage.tsx.

Не считать предложенный код уже существующим, если его нет в репозитории.


# 42. План разработки после project-storage

После того как feature/project-storage полностью стабильна:

merge feature/project-storage → main

Затем новая feature branch:

feature/esp-idf-manager

Предпочтительный порядок дальнейших крупных работ:

ESP-IDF Manager
↓
Build subsystem
↓
Problems/Output
↓
COM/device detection
↓
Flash
↓
Serial Monitor
↓
Pin Manager
↓
Git Manager
↓
AI Core
↓
Project Memory integration
↓
Settings/User Guide
↓
Installer


# 43. Важное правило для развития проекта

Не пытаться реализовать сразу всё.

Предпочтительны небольшие логические изменения.

После изменений:

npm.cmd run typecheck

При необходимости:

npm.cmd run dev

Перед большими изменениями сначала изучить текущие:

src/main/
src/preload/
src/renderer/

Не предполагать структуру файла по старому чату — текущий репозиторий является источником истины.


# 44. Coding style / работа с существующим кодом

Не переписывать большие компоненты без необходимости.

Сначала понять существующую архитектуру.

Предпочитать:

minimal targeted changes

вместо:

complete rewrite

Не ломать уже работающие:

- project creation;
- project open;
- recent projects;
- app state;
- Monaco models;
- CodeEditor keep alive;
- file save;
- dirty detection;
- custom dialogs.

После каждого значимого этапа запускать typecheck.


# 45. Product philosophy

ESP AI Studio не должна быть "AI, который иногда показывает код".

Она должна быть полноценной ESP32 IDE, где AI встроен как помощник.

Пользователь должен иметь полный контроль.

Ручной workflow:

Write → Build → Flash → Monitor

должен работать без AI.

AI workflow:

Ask AI
→ AI understands project
→ proposes changes/actions
→ user confirms
→ IDE performs operation
→ result/log returned to AI
→ AI explains result

Также возможен смешанный workflow:

пользователь пишет часть вручную,
AI исправляет/объясняет/добавляет часть,
пользователь контролирует всё.


# 46. Что Codex должен сделать первым

Перед любыми новыми изменениями:

1. Прочитать этот файл полностью.
2. Посмотреть `git status`.
3. Посмотреть текущую branch.
4. Изучить текущий `App.tsx`.
5. Изучить `CodeEditorPage.tsx`.
6. Изучить `src/main/index.ts`.
7. Изучить `src/preload/index.ts`.
8. Изучить `src/preload/index.d.ts`.
9. Запустить `npm.cmd run typecheck`.
10. Только после этого определить реальное текущее состояние проекта.

Если код расходится с этим документом:

- существующий код является источником истины относительно того, что уже реализовано;
- этот документ является источником истины относительно требований и направления проекта.

Не удалять работающую функциональность только потому, что её структура отличается от предполагаемой.


# 47. Ближайшая задача

Текущая ближайшая задача:

завершить `feature/project-storage`.

Нужно сделать независимые editor sessions для каждого projectPath.

Пример ожидаемого поведения:

Project 1:

[CMakeLists.txt] [.gitignore] [main/main.c]
                     ↑ active

В CMakeLists.txt может быть unsaved text.

Пользователь переключается:

Project 1 → Project 2

У Project 2 свои tabs.

Затем:

Project 2 → Project 1

Должны вернуться:

- те же tabs;
- тот же active file;
- тот же unsaved text.

Ни один buffer Project 1 не должен появляться в Project 2.

После этого editor session нужно сохранять в app-state, чтобы оно переживало полный restart приложения.


# 48. Что пока НЕ считать реализованным

Пока не считать готовыми:

- ESP-IDF automatic installation;
- ESP-IDF Manager;
- real Build;
- Full Clean;
- Menuconfig;
- Size;
- COM detection;
- Flash;
- Erase Flash;
- Serial Monitor;
- embedded Terminal;
- complete Pin Manager;
- Project Memory backend;
- ChatGPT integration;
- Gemini integration;
- AI file editing;
- AI auto-fix;
- GitHub integration;
- complete Git UI;
- installer;
- SQLite persistence;
- multi-chat persistence;
- graphical schematic.

Эти функции входят в требования, но должны реализовываться постепенно.


# 49. Главная цель

Финальный ESP AI Studio должен позволить человеку открыть приложение, создать ESP32 проект и пройти весь цикл:

Create/Open Project
→ Edit Code
→ Configure ESP32
→ Build
→ Fix Errors
→ Select Device
→ Flash
→ Monitor
→ Debug

и при желании подключить AI на любом этапе.

AI должен видеть контекст проекта и помогать, но пользователь остаётся тем, кто контролирует действия.