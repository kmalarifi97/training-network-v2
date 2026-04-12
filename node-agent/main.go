package main

import (
	"fmt"
	"os"

	"gpu-network-v2/node-agent/cmd"
)

func main() {
	if err := cmd.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
