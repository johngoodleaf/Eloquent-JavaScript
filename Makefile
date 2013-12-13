all: html tex

CHAPTERS := 00_intro 01_values 02_program_structure 03_functions 04_data 05_higher_order 06_object 07_elife 08_error

html: $(foreach CHAP,$(CHAPTERS),html/$(CHAP).html)

html/%.html: %.txt asciidoc_html.conf
	PATH=node_modules/codemirror/bin:$(PATH) asciidoc -f asciidoc_html.conf --backend=html5 -o $@ $<
	node bin/build_code.js $<

tex: $(foreach CHAP,$(CHAPTERS),tex/$(CHAP).tex)

tex/%.db: %.txt asciidoc_db.conf
	asciidoc -f asciidoc_db.conf --backend=docbook -o $@ $<

tex/%.tex: tex/%.db
	dblatex $< -o $@ -t tex

test:
	@for F in $(CHAPTERS); do echo Testing $$F:; node bin/run_tests.js $$F.txt; done
	@echo Done.
