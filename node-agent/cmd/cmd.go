package cmd

import "fmt"

type command struct {
	name string
	run  func(args []string) error
}

var commands = []command{
	{"init", runInit},
	{"login", runLogin},
	{"start", runStart},
	{"status", runStatus},
	{"version", runVersion},
	{"help", runHelp},
}

func Run(args []string) error {
	if len(args) == 0 {
		return runHelp(nil)
	}

	name := args[0]
	for _, c := range commands {
		if c.name == name {
			return c.run(args[1:])
		}
	}

	return fmt.Errorf("unknown command: %q\n\nRun 'gpu-agent help' for usage", name)
}

func runHelp(_ []string) error {
	fmt.Println(`gpu-agent — worker agent for GPU Network

Usage:
  gpu-agent <command>

Commands:
  init      Register this node with a claim token (legacy)
  login     Register this node via browser-approved device code
  start     Run the agent daemon
  status    Show local agent status
  version   Show agent version
  help      Show this help`)
	return nil
}
