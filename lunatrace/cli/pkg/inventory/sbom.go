// Copyright 2022 by LunaSec (owned by Refinery Labs, Inc)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
package inventory

import (
	"crypto"
	"fmt"
	"github.com/anchore/syft/syft"
	"github.com/anchore/syft/syft/artifact"
	"github.com/anchore/syft/syft/file"
	"github.com/anchore/syft/syft/pkg/cataloger"
	"github.com/anchore/syft/syft/sbom"
	"github.com/anchore/syft/syft/source"
	"github.com/rs/zerolog/log"
	"lunasec/lunatrace/pkg/constants"
	"lunasec/lunatrace/pkg/util"
	"os"
	"path/filepath"
)

func getSyftSource(sourceName string, excludedDirs []string, useStdin bool) (src *source.Source, cleanup func(), err error) {
	if useStdin {
		var (
			tmpSourceFile *os.File
		)

		tmpSourceFile, err = util.GetFileFromStdin(sourceName)
		if err != nil {
			return
		}

		syftSrc, cleanupFunc := source.NewFromFile(tmpSourceFile.Name())
		src = &syftSrc

		cleanup = func() {
			tmpDir := filepath.Dir(tmpSourceFile.Name())
			util.CleanupTmpFileDirectory(tmpDir)
			cleanupFunc()
		}
		return
	}

	src, cleanup, err = source.New("file:"+sourceName, nil, excludedDirs)
	if err != nil {
		err = fmt.Errorf("failed to construct source from user input %q: %w", sourceName, err)
		return
	}
	return
}

func getSbomFromStdinFile(sourceName string, excludedDirs []string, useStdin bool) (s *sbom.SBOM, err error) {
	log.Info().
		Str("source", sourceName).
		Msg("Scanning source for dependencies.")

	src, cleanup, err := getSyftSource(sourceName, excludedDirs, useStdin)
	if cleanup != nil {
		defer cleanup()
	}

	log.Info().
		Str("source", sourceName).
		Msg("Completed scanning source.")

	s = &sbom.SBOM{
		Source: src.Metadata,
		Descriptor: sbom.Descriptor{
			Name:    constants.LunaTraceName,
			Version: constants.LunaTraceVersion,
		},
	}

	err = collectRelationships(sourceName, s, src)
	if err != nil {
		return
	}
	return
}

func getSbomFromRepository(repoDir string, excludedDirs []string) (s *sbom.SBOM, err error) {
	log.Info().
		Str("repoDir", repoDir).
		Msg("Scanning repository directory for dependencies.")

	src, cleanup, err := source.New("dir:"+repoDir, nil, excludedDirs)
	if err != nil {
		err = fmt.Errorf("failed to construct source from repo %s: %w", repoDir, err)
		return
	}
	defer cleanup()

	log.Info().
		Str("repoDir", repoDir).
		Msg("Completed scanning source.")

	s = &sbom.SBOM{
		Source: src.Metadata,
		Descriptor: sbom.Descriptor{
			Name:    constants.LunaTraceName,
			Version: constants.LunaTraceVersion,
		},
	}

	err = collectRelationships(repoDir, s, src)
	if err != nil {
		return
	}
	return
}

func collectRelationships(searchDir string, s *sbom.SBOM, src *source.Source) (err error) {
	log.Info().
		Str("searchDir", searchDir).
		Msg("Collecting relationships between dependencies and files.")

	tasks, err := getTasks()
	if err != nil {
		return
	}

	var relationships []<-chan artifact.Relationship
	for _, task := range tasks {
		c := make(chan artifact.Relationship)
		relationships = append(relationships, c)

		err = runTask(task, &s.Artifacts, src, c)
		if err != nil {
			return
		}
	}
	s.Relationships = append(s.Relationships, mergeRelationships(relationships...)...)

	log.Info().
		Str("searchDir", searchDir).
		Msg("Completed collecting relationships between dependencies and files.")
	return
}

func runTask(t task, a *sbom.Artifacts, src *source.Source, c chan<- artifact.Relationship) (err error) {
	defer close(c)

	relationships, err := t(a, src)
	if err != nil {
		return
	}

	for _, relationship := range relationships {
		c <- relationship
	}
	return
}

func mergeRelationships(cs ...<-chan artifact.Relationship) (relationships []artifact.Relationship) {
	for _, c := range cs {
		for n := range c {
			relationships = append(relationships, n)
		}
	}

	return relationships
}

type task func(*sbom.Artifacts, *source.Source) ([]artifact.Relationship, error)

func getTasks() ([]task, error) {
	var tasks []task

	generators := []func() (task, error){
		generateCatalogPackagesTask,
		//generateCatalogFileMetadataTask,
		//generateCatalogFileClassificationsTask,
	}

	for _, generator := range generators {
		task, err := generator()
		if err != nil {
			return nil, err
		}

		if task != nil {
			tasks = append(tasks, task)
		}
	}

	return tasks, nil
}
func generateCatalogPackagesTask() (task, error) {
	task := func(results *sbom.Artifacts, src *source.Source) ([]artifact.Relationship, error) {
		packageCatalog, relationships, theDistro, err := syft.CatalogPackages(src, cataloger.DefaultConfig())
		if err != nil {
			return nil, err
		}

		results.PackageCatalog = packageCatalog
		results.LinuxDistribution = theDistro

		return relationships, nil
	}

	return task, nil
}

func generateCatalogFileMetadataTask() (task, error) {
	metadataCataloger := file.NewMetadataCataloger()

	task := func(results *sbom.Artifacts, src *source.Source) ([]artifact.Relationship, error) {
		resolver, err := src.FileResolver(source.UnknownScope)
		if err != nil {
			return nil, err
		}

		result, err := metadataCataloger.Catalog(resolver)
		if err != nil {
			return nil, err
		}
		results.FileMetadata = result
		return nil, nil
	}

	return task, nil
}

func generateCatalogFileClassificationsTask() (task, error) {
	// TODO: in the future we could expose out the classifiers via configuration
	classifierCataloger, err := file.NewClassificationCataloger(file.DefaultClassifiers)
	if err != nil {
		return nil, err
	}

	task := func(results *sbom.Artifacts, src *source.Source) ([]artifact.Relationship, error) {
		resolver, err := src.FileResolver(source.UnknownScope)
		if err != nil {
			return nil, err
		}

		result, err := classifierCataloger.Catalog(resolver)
		if err != nil {
			return nil, err
		}
		results.FileClassifications = result
		return nil, nil
	}

	return task, nil
}

func generateCatalogFileDigestsTask() (task, error) {
	hashes := []crypto.Hash{
		crypto.SHA256,
	}

	digestsCataloger, err := file.NewDigestsCataloger(hashes)
	if err != nil {
		return nil, err
	}

	task := func(results *sbom.Artifacts, src *source.Source) ([]artifact.Relationship, error) {
		resolver, err := src.FileResolver(source.UnknownScope)
		if err != nil {
			return nil, err
		}

		result, err := digestsCataloger.Catalog(resolver)
		if err != nil {
			return nil, err
		}
		results.FileDigests = result
		return nil, nil
	}

	return task, nil
}
