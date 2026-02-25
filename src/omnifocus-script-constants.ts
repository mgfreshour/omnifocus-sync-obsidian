/**
 * OmniFocus AppleScript source strings.
 * Used by omnifocus-applescript.ts for osascript execution.
 */

export const SCRIPT_FETCH_PROJECT_PATHS = `
tell application "OmniFocus"
  tell default document
    set rootFolders to every folder
    set rootProjects to every project
  end tell
  set lf to character id 10
  set out to ""
  repeat with f in rootFolders
    set fname to name of f
    set sub to my collectFromFolder(f, fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in rootProjects
    set pname to name of p
    if length of out > 0 then set out to out & lf
    set out to out & pname
  end repeat
  return out
end tell

on collectFromFolder(theFolder, prefix)
  tell application "OmniFocus"
    tell theFolder
      set folderList to every folder
      set projectList to every project
    end tell
  end tell
  set lf to character id 10
  set out to ""
  repeat with f in folderList
    set fname to name of f
    set sub to my collectFromFolder(f, prefix & fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in projectList
    set pname to name of p
    if length of out > 0 then set out to out & lf
    set out to out & (prefix & pname)
  end repeat
  return out
end collectFromFolder
`;

export const SCRIPT_FETCH_PROJECT_PATHS_WITH_NOTES = `
tell application "OmniFocus"
  tell default document
    set rootFolders to every folder
    set rootProjects to every project
  end tell
  set sep to character id 31
  set lf to character id 10
  set out to ""
  repeat with f in rootFolders
    set fname to name of f
    set sub to my collectFromFolderWithNotes(f, fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in rootProjects
    tell application "OmniFocus"
      set pname to name of p
      set noteText to note of p
      if noteText is missing value then set noteText to ""
    end tell
    set oldTID to AppleScript's text item delimiters
    set AppleScript's text item delimiters to lf
    set noteParts to text items of noteText
    set AppleScript's text item delimiters to "\\\\n"
    set noteSafe to noteParts as text
    set AppleScript's text item delimiters to oldTID
    if length of out > 0 then set out to out & lf
    set out to out & pname & sep & noteSafe
  end repeat
  return out
end tell

on collectFromFolderWithNotes(theFolder, prefix)
  tell application "OmniFocus"
    tell theFolder
      set folderList to every folder
      set projectList to every project
    end tell
  end tell
  set sep to character id 31
  set lf to character id 10
  set out to ""
  repeat with f in folderList
    set fname to name of f
    set sub to my collectFromFolderWithNotes(f, prefix & fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in projectList
    tell application "OmniFocus"
      set pname to name of p
      set noteText to note of p
      if noteText is missing value then set noteText to ""
    end tell
    set oldTID to AppleScript's text item delimiters
    set AppleScript's text item delimiters to lf
    set noteParts to text items of noteText
    set AppleScript's text item delimiters to "\\\\n"
    set noteSafe to noteParts as text
    set AppleScript's text item delimiters to oldTID
    if length of out > 0 then set out to out & lf
    set out to out & (prefix & pname) & sep & noteSafe
  end repeat
  return out
end collectFromFolderWithNotes
`;

export const SCRIPT_FETCH_PROJECT_NAMES = `
tell application "OmniFocus"
  tell default document
    set projectNames to name of every flattened project
  end tell
  set AppleScript's text item delimiters to linefeed
  return projectNames as text
end tell
`;

export const SCRIPT_FETCH_PROJECTS_WITH_NOTES = `
tell application "OmniFocus"
  tell default document
    set projectList to every flattened project
    set output to ""
    set oldTID to AppleScript's text item delimiters
    repeat with i from 1 to count of projectList
      set proj to item i of projectList
      set projName to name of proj
      set noteText to note of proj
      if noteText is missing value then set noteText to ""
      set AppleScript's text item delimiters to linefeed
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & character id 10
      set output to output & projName & character id 31 & noteSafe
    end repeat
    return output
  end tell
end tell
`;

export const SCRIPT_FETCH_TAG_NAMES = `
tell application "OmniFocus"
  tell default document
    set tagNames to name of every flattened tag
  end tell
  set AppleScript's text item delimiters to linefeed
  return tagNames as text
end tell
`;

export const TASK_LOOP_WITH_COMPLETED = `
    set output to ""
    set sep to character id 31
    set lf to character id 10
    repeat with i from 1 to count of taskList
      set t to item i of taskList
      set taskName to name of t
      set taskId to id of t
      set noteText to note of t
      if noteText is missing value then set noteText to ""
      set taskCompleted to completed of t
      set oldTID to AppleScript's text item delimiters
      set AppleScript's text item delimiters to lf
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & linefeed
      set output to output & taskName & sep & taskId & sep & noteSafe & sep & taskCompleted
    end repeat
    return output
`;

export const TASK_LOOP_WITHOUT_COMPLETED = `
    set output to ""
    set sep to character id 31
    set lf to character id 10
    repeat with i from 1 to count of taskList
      set t to item i of taskList
      set taskName to name of t
      set taskId to id of t
      set noteText to note of t
      if noteText is missing value then set noteText to ""
      set oldTID to AppleScript's text item delimiters
      set AppleScript's text item delimiters to lf
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & linefeed
      set output to output & taskName & sep & taskId & sep & noteSafe
    end repeat
    return output
`;

export const SCRIPT_COMPLETE_TASK = `
on run argv
  set taskId to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      mark complete theTask
    end tell
  end tell
end run
`;

export const SCRIPT_UPDATE_TASK = `
on run argv
  set taskId to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      set name of theTask to taskName
      set note of theTask to taskNote
    end tell
  end tell
end run
`;

export const SCRIPT_CREATE_PROJECT = `
on run argv
  set projectName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      make new project with properties {name: projectName}
    end tell
  end tell
end run
`;

export const SCRIPT_UPDATE_PROJECT_NOTE = `
on run argv
  set projectName to item 1 of argv
  set noteText to item 2 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      set note of proj to noteText
    end tell
  end tell
end run
`;

export const SCRIPT_MOVE_TASK = `
on run argv
  set taskId to item 1 of argv
  set projectName to item 2 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      set proj to first flattened project whose name is projectName
      move theTask to end of tasks of proj
    end tell
  end tell
end run
`;

export const SCRIPT_CREATE_INBOX_TASK = `
on run argv
  set taskName to item 1 of argv
  set taskNote to item 2 of argv
  tell application "OmniFocus"
    tell default document
      make new inbox task with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
`;

export const SCRIPT_CREATE_PROJECT_TASK = `
on run argv
  set projectName to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      make new task at end of tasks of proj with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
`;

export const SCRIPT_CREATE_TAG_TASK = `
on run argv
  set tagName to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set theTag to first flattened tag whose name is tagName
      set t to make new inbox task with properties {name: taskName, note: taskNote}
      set primary tag of t to theTag
    end tell
  end tell
end run
`;
