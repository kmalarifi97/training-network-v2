package cmd

import "fmt"

const Version = "0.1.0"

func runVersion(_ []string) error {
	fmt.Println(Version)
	return nil
}
